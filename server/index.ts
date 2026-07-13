import http from 'node:http';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChatAction, ClientCommand, Task } from '../shared/types.ts';
import { serverStore as S, id } from './store.ts';
import { orchestrator } from './orchestrator.ts';
import { chatAgent, configureLlm, isLlmReady, llmInfo, validateLlm } from './llm.ts';
import { resultFiles } from './resultFiles.ts';
import { DEFAULT_BACKEND_PORT } from '../shared/config.ts';
import { setProfile } from './vault.ts';

// ---- HTTP API ----
const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: llmInfo() });
});

app.get('/api/files/:id', (req, res) => {
  const file = resultFiles.resolve(req.params.id);
  if (!file) return res.sendStatus(404);
  res.download(file.path, file.name);
});

// ---- WebSocket protocol ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const unsub = S.subscribe((e) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
  });

  ws.on('message', async (buf) => {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(buf.toString());
    } catch {
      return;
    }
    try {
      await handleCommand(cmd);
    } catch (error) {
      console.error(`[server] command=${cmd.type} failed: ${(error as Error).message}`);
    }
  });

  ws.on('close', unsub);
});

async function handleCommand(cmd: ClientCommand) {
  switch (cmd.type) {
    case 'message':
      await handleMessage(cmd.text);
      break;
    case 'resolve_block':
      orchestrator.resolveBlock(cmd.taskId, cmd.value, {
        applyToAll: cmd.applyToAll,
        allowDomain: cmd.allowDomain,
      });
      break;
    case 'new_chat':
      S.clearChat();
      break;
    case 'browser_pointer':
      await orchestrator.handlePointer(cmd.x, cmd.y);
      break;
    case 'browser_key':
      await orchestrator.handleKey(cmd.key, cmd.text);
      break;
    case 'resume_agent':
      orchestrator.resumeManual();
      break;
    case 'setup': {
      const name = cmd.name.trim();
      const email = cmd.email.trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !configureLlm(cmd.apiKey)) {
        S.emit({ type: 'setup_error', message: 'Enter a name, valid email, and API key.' });
        break;
      }
      if (!(await validateLlm())) {
        S.emit({ type: 'setup_error', message: 'That DeepSeek key could not be verified.' });
        break;
      }
      S.setupProfile = { name, email };
      setProfile({ name, email });
      S.emit({ type: 'setup_ready', profile: S.setupProfile });
      break;
    }
  }
}

// ---- Chat handling ----
async function handleMessage(text: string) {
  if (!isLlmReady()) return;
  S.chat({ id: id('c'), kind: 'user', text, createdAt: Date.now() });
  let reply: string;
  let actions;
  try {
    ({ reply, actions } = await chatAgent(text, S.tasks, S.modelHistory().slice(0, -1)));
  } catch (err) {
    console.error('[chat] chatAgent failed:', err);
    if (/401|authentication/i.test(String(err))) {
      S.setupProfile = null;
      S.emit({ type: 'setup_error', message: 'DeepSeek rejected the saved key.' });
    } else {
      S.chat({ id: id('c'), kind: 'activity', text: 'The request failed. Check the server log.', createdAt: Date.now() });
    }
    return;
  }

  if (reply.trim()) {
    S.chat({ id: id('c'), kind: 'assistant', text: reply.trim(), createdAt: Date.now() });
  }

  let shouldRun = false;
  for (const action of actions) {
    if (applyAction(action)) shouldRun = true;
  }
  if (shouldRun) orchestrator.runLoop();
}

// ---- Task actions ----
function applyAction(action: ChatAction): boolean {
  switch (action.type) {
    case 'add_task': {
      const order_position = action.priority === 'high' ? S.frontPosition() : nextOrder();
      const task: Task = {
        id: id('t'),
        title: action.title,
        status: 'queued',
        order_position,
        createdAt: Date.now(),
      };
      S.addTask(task);
      activity(`queued ${task.title}`);
      return true;
    }
    case 'remove_task': {
      const match = findTask(action.query);
      if (match) {
        S.removeTask(match.id);
        orchestrator.cancelBlock(match.id);
        activity(`removed ${match.title}`);
      } else {
        activity(`nothing matching “${action.query}”`);
      }
      return false;
    }
    case 'prioritize_task': {
      const match = findTask(action.query);
      if (match) {
        S.updateTask(match.id, { order_position: S.frontPosition() });
        activity(`moved ${match.title} to the front`);
        return true;
      }
      activity(`nothing matching “${action.query}”`);
      return false;
    }
    case 'list_tasks': {
      const open = S.tasks.filter((t) => t.status !== 'done');
      activity(open.length ? `${open.length} in the queue: ${open.map((t) => t.title).join(', ')}` : 'queue is empty');
      return false;
    }
    case 'clear_tasks': {
      const open = S.tasks.filter((t) => t.status !== 'done' && t.status !== 'running');
      open.forEach((t) => {
        S.removeTask(t.id);
        orchestrator.cancelBlock(t.id);
      });
      activity(open.length ? `cleared ${open.length} task${open.length === 1 ? '' : 's'}` : 'nothing to clear');
      return false;
    }
    case 'run':
      return true;
  }
}

function activity(text: string) {
  S.chat({ id: id('c'), kind: 'activity', text, createdAt: Date.now() });
}

function nextOrder(): number {
  return S.tasks.reduce((m, t) => Math.max(m, t.order_position), -1) + 1;
}

function findTask(query: string): Task | undefined {
  const q = query.toLowerCase().trim();
  if (!q) return undefined;
  const open = S.tasks.filter((t) => t.status !== 'done');
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  return (
    open.find((t) => t.title.toLowerCase().includes(q)) ??
    open.find((t) => words.length > 0 && words.every((w) => t.title.toLowerCase().includes(w)))
  );
}

// ---- Startup ----
const PORT = DEFAULT_BACKEND_PORT;
server.listen(PORT, () => {
  console.log(`\n  Docket backend running at http://localhost:${PORT}`);
  console.log(`  LLM: ${llmInfo()}\n`);
});
