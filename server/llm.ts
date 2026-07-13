import type { AgentAction, ChatMessage as DocketMessage, ChatResult, ManifestElement, Task } from '../shared/types.ts';

// ---- DeepSeek client ----
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

// ---- Chat + task tools ----
export async function chatAgent(message: string, tasks: Task[], history: DocketMessage[] = []): Promise<ChatResult> {
  const sys =
    'You are Docket, a friendly assistant that can run tasks in a real web browser. ' +
    'Respond with ONLY a JSON object: {"reply": string, "actions": ChatAction[]}. ' +
    'ChatAction is one of: {"type":"add_task","title":string,"priority":"high"|"normal"} | ' +
    '{"type":"remove_task","query":string} | {"type":"prioritize_task","query":string} | ' +
    '{"type":"list_tasks"} | {"type":"clear_tasks"} | {"type":"run"}. ' +
    'Split multi-part requests into separate tasks and add {"type":"run"} when there is new work. ' +
    'Use "query" to reference an existing task by a few words of its title. ' +
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

// ---- Browser action step ----
export interface AgentStepInput {
  task: Task;
  url: string;
  manifest: ManifestElement[];
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
    '{"type":"navigate","url":s} | {"type":"wait","ms":n} | {"type":"done","note":s} | ' +
    '{"type":"blocked","reason":s,"kind":"otp|captcha|credential|password_setup|domain_permission|ambiguous"}. ' +
    'Use Google (google.com) for web searches unless the task asks for a specific site. ' +
    'Prefer typing and pressing Enter over hunting for buttons. ' +
    'Check the recent actions before deciding: never repeat an action you already took, and never run the same search twice. ' +
    'Element labels include link and result text, so once search results are showing, read them for the answer ' +
    'and finish with done, or click a promising result. ' +
    'Only say done when the page actually shows the result, and put that evidence in the note. ' +
    'If a captcha or human verification check appears, report blocked with kind "captcha". ' +
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
            `Task: ${input.task.title}\nCurrent page: ${input.url}\n\nManifest:\n${manifestText || '(no interactive elements found)'}\n\n` +
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

// ---- Run summary ----
export async function summarizeRun(taskTitle: string, notes: string[]): Promise<string> {
  const text = await deepseek(
    [
      {
        role: 'system',
        content:
          'Give the user the result of their task in one or two short sentences. ' +
          'Lead with the answer or outcome itself, like "The capital of Australia is Canberra." ' +
          'Do not describe the steps taken. If files were downloaded, say what they contain. ' +
          'Only use information that appears in the steps. If the steps do not contain the answer ' +
          'or a completed outcome, say plainly that the task did not finish. Never guess.',
      },
      { role: 'user', content: `Task: ${taskTitle}\nSteps:\n${notes.join('\n')}` },
    ],
    120,
    false
  );
  return text.trim();
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
