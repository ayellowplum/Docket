import type { AgentAction, ChatMessage as DocketMessage, ChatResult, ManifestElement, Task } from '../shared/types.ts';

const BASE_URL = 'https://api.deepseek.com';
const API_URL = `${BASE_URL}/chat/completions`;
const MODEL = 'deepseek-chat';
const TIMEOUT_MS = 30000;
let apiKey: string | undefined;

export function llmInfo(): string {
  return `DeepSeek (${MODEL})`;
}

export function configureLlm(value: string): boolean {
  const key = value.trim();
  if (!key) return false;
  apiKey = key;
  return true;
}

export function isLlmReady(): boolean {
  return Boolean(apiKey);
}

export async function validateLlm(): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const response = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) apiKey = undefined;
    return response.ok;
  } catch {
    apiKey = undefined;
    return false;
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function deepseek(messages: ChatMessage[], maxTokens: number, json = true): Promise<string> {
  if (!apiKey) throw new Error('DeepSeek is not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`DeepSeek API ${resp.status} ${resp.statusText}: ${body.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`DeepSeek API timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function chatAgent(message: string, tasks: Task[], history: DocketMessage[] = []): Promise<ChatResult> {
  const sys =
    'You are Docket, a friendly assistant that can run tasks in a real web browser. ' +
    'Respond with ONLY a JSON object: {"reply": string, "actions": ChatAction[]}. ' +
    'ChatAction is one of: {"type":"add_task","title":string,"priority":"high"|"normal"} | ' +
    '{"type":"remove_task","query":string} | {"type":"prioritize_task","query":string} | ' +
    '{"type":"remember","key":string,"value":string} | {"type":"forget_memory","query":string} | {"type":"list_memories"} | ' +
    '{"type":"list_tasks"} | {"type":"clear_tasks"} | {"type":"run"}. ' +
    'Split multi-part requests into separate tasks and add {"type":"run"} when there is new work. ' +
    'Use "query" to reference an existing task by a few words of its title. ' +
    'If the user says to remember something, save a concise permanent memory and do not create a browser task unless they also ask for work. ' +
    'If the user asks what you remember or to forget something, use the memory actions. ' +
    'Do not store passwords, API keys, one-time codes, or other secrets as permanent memories. ' +
    'For greetings or smalltalk just reply with empty actions. If a request is too vague, ask a short ' +
    'clarifying question instead of inventing a task. ' +
    'Keep replies to a sentence or two of plain text. Bold with ** is the only markup allowed.';

  const text = await deepseek(
    [
      { role: 'system', content: sys },
      ...history.slice(-12).map((entry) => ({
        role: entry.kind as 'user' | 'assistant',
        content: entry.text,
      })),
      {
        role: 'user',
        content:
          `Current tasks: ${JSON.stringify(tasks.map((t) => ({ title: t.title, status: t.status })))}\n\n` +
          `User: "${message}"`,
      },
    ],
    700
  );
  const parsed = safeJson<ChatResult>(text);
  if (parsed && Array.isArray(parsed.actions)) {
    return { reply: parsed.reply ?? '', actions: parsed.actions };
  }
  throw new Error('DeepSeek returned an invalid chat response');
}

export interface AgentStepInput {
  task: Task;
  url: string;
  manifest: ManifestElement[];
  pageText: string;
  userContext: string;
  history: string[];
  injectedContext?: string;
}

export async function decideAction(input: AgentStepInput): Promise<AgentAction> {
  const sys =
    'You are Docket, a web agent. You get a task and a numbered list of the interactive elements ' +
    'on the current page. Respond with ONLY one JSON action, targeting elements by id: ' +
    '{"type":"click","id":n} | {"type":"type","id":n,"value":s} | {"type":"press","key":"Enter|Tab|Escape|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Meta+A|Control+A|Meta+L|Control+L"} | ' +
    '{"type":"fill_field","id":n,"field":"email|password|name|phone|address"} | ' +
    '{"type":"scroll","to":n} | {"type":"scroll","direction":"up|down"} | ' +
    '{"type":"navigate","url":s} | {"type":"home"} | {"type":"wait","ms":n} | ' +
    '{"type":"storage","op":"list|read|write|delete|attach","path":s,"content":s} | ' +
    '{"type":"memory","op":"list|remember|forget","key":s,"value":s,"query":s} | ' +
    '{"type":"command","command":s} | {"type":"done","note":s} | ' +
    '{"type":"blocked","reason":s,"kind":"otp|captcha|credential|password_setup|domain_permission|manual|memory|ambiguous"}. ' +
    'You have a private per-task file workspace. Browser downloads are saved there automatically. ' +
    'Use storage list/read/write/delete/attach to manage files. Use attach only for files the user should receive in the final result. ' +
    'Use command for terminal work inside the task workspace, such as inspecting files, converting media, trimming videos, running scripts, or installing task-local packages when needed. ' +
    'Prefer simple, safe commands and include useful command output in the final done note. ' +
    'Use Google (google.com) for web searches unless the task asks for a specific site. ' +
    'Use home to reset the browser to Google when the current page is irrelevant, stuck, or a clean search start is needed. ' +
    'Use permanent memories from user context when relevant. These may include city/location, timezone, preferences, dietary needs, project details, formatting preferences, or recurring personal context. ' +
    'Use memory list/remember/forget to inspect or update permanent memories when the task reveals useful long-term context or when the user asks you to remember or forget something. ' +
    'Do not save passwords, API keys, one-time codes, or other secrets to memory. ' +
    'If a task needs missing reusable generic user information, report blocked with kind "memory" and ask one concise question. The answer will be saved automatically as a permanent memory, so only ask for information worth reusing later. ' +
    'Prefer typing and pressing Enter over hunting for buttons. ' +
    'Check the recent actions before deciding: never repeat an action you already took, and never run the same search twice. ' +
    'Use the visible page text as the main evidence for factual answers, recipes, product details, prices, instructions, and page content. ' +
    'Element labels include link and result text, so once search results are showing, read them for the answer or click a promising result. ' +
    'Only say done when the page actually shows the result. The done note must contain the concrete answer, not just that a page is visible. ' +
    'For recipes, include key ingredients and basic steps if visible. For searches, include the found result and useful facts from the page. ' +
    'For requests asking for options, ideas, suggestions, recommendations, or examples, do not finish with only a list of websites or source names. ' +
    'Open a useful result or use visible page text until the done note includes concrete items that answer the request. ' +
    'If a captcha or human verification check appears, report blocked with kind "captcha". ' +
    'Use blocked kind "manual" only when browser interaction is technically stuck, such as a modal blocking clicks, page controls not responding, or the page needs a small human browser action. Keep the reason short and tell the user what to fix, then resume. ' +
    'Use blocked kind "ambiguous" only when the task itself needs missing information from the user. ' +
    'Never type real passwords or personal details yourself, use fill_field for those. ' +
    'If the page is empty or confusing, navigate somewhere useful or report blocked.';

  const manifestText = input.manifest
    .map(
      (e) =>
        `[${e.id}] ${e.role} "${e.label}" @(${Math.round(e.bbox.x)},${Math.round(e.bbox.y)},${Math.round(e.bbox.width)}x${Math.round(e.bbox.height)})`
    )
    .join('\n');

  try {
    const text = await deepseek(
      [
        { role: 'system', content: sys },
        {
          role: 'user',
          content:
            `Task: ${input.task.title}\nCurrent page: ${input.url}\nUser context:\n${input.userContext || '(none saved)'}\n\nVisible page text:\n${input.pageText || '(no visible text captured)'}\n\nManifest:\n${manifestText || '(no interactive elements found)'}\n\n` +
            `Recent actions:\n${input.history.slice(-6).join('\n') || '(none)'}` +
            (input.injectedContext ? `\n\nUser just provided: ${input.injectedContext}` : ''),
        },
      ],
      512
    );
    const action = safeJson<AgentAction>(text);
    if (action) return action;
    return { type: 'blocked', reason: 'Could not parse a valid next step', kind: 'ambiguous' };
  } catch (err) {
    console.error('[llm] decideAction failed:', err);
    return { type: 'blocked', reason: `Reasoning failed: ${(err as Error).message}`, kind: 'ambiguous' };
  }
}

export interface RunSummary {
  summary: string;
  details: string[];
}

export async function summarizeRun(taskTitle: string, notes: string[], files: { name: string; size: number }[]): Promise<RunSummary> {
  const text = await deepseek(
    [
      {
        role: 'system',
        content:
          'Return ONLY JSON: {"summary": string, "details": string[]}. ' +
          'The summary is one useful sentence that answers the task directly. Do not repeat the task title. ' +
          'The details are 3 to 8 useful result bullets with the actual information found, decisions made, file changes, command outputs, or final artifacts. Format details as clean standalone items, not browser logs. ' +
          'When details contain concrete result items, pre-generate hover explanations using [[visible text|expanded detail]]. Annotate sparingly: usually 1 to 3 of the most important items only, and never every bullet or every similar item. ' +
          'Only annotate key items where extra context materially helps. Leave ordinary text unannotated. ' +
          'The hover detail should be substantial, usually 2 to 4 sentences, based on the notes. Add context such as ingredients, method, source detail, tradeoffs, why the item is useful, or what the user should know next. ' +
          'Do not include lines like clicked, typed, searched, navigated, or the page shows. ' +
          'If the task is a recipe, details should include ingredients, timing, and main cooking steps when present. ' +
          'If the task asks for options, ideas, suggestions, recommendations, or examples, details should be the actual items with useful context, not a list of sites. ' +
          'If notes only contain source names or website titles, say the actual requested items were not captured instead of presenting the source list as the answer. ' +
          'If the task asks for research, details should include the key facts, names, numbers, dates, URLs, or source names that appear in the notes. ' +
          'If files are attached, describe what each file is and why it is included. ' +
          'If the notes do not contain enough information to answer, set summary to "The task finished, but the result details were not captured." and explain what is missing in details. ' +
          'Use only information from the notes. Never guess.',
      },
      {
        role: 'user',
        content:
          `Task: ${taskTitle}\n` +
          `Attached files: ${files.length ? JSON.stringify(files) : '(none)'}\n` +
          `Run notes:\n${notes.join('\n')}`,
      },
    ],
    900
  );
  const parsed = safeJson<RunSummary>(text);
  if (parsed?.summary && Array.isArray(parsed.details)) {
    return {
      summary: parsed.summary.trim(),
      details: parsed.details.map((detail) => String(detail).trim()).filter(Boolean).slice(0, 8),
    };
  }
  return {
    summary: 'The task finished, but the result details were not captured.',
    details: ['The browser completed the task, but the final notes did not include enough specific result information.'],
  };
}

function safeJson<T>(text: string): T | null {
  const match = text.match(/[[{][\s\S]*[\]}]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
