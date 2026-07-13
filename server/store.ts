import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentOverlayState,
  BrowserView,
  ChatSessionSummary,
  ChatMessage,
  RunLogEntry,
  ServerEvent,
  Task,
  SetupProfile,
} from '../shared/types.ts';

type Listener = (e: ServerEvent) => void;
interface ChatSession {
  id: string;
  title: string;
  tasks: Task[];
  logs: RunLogEntry[];
  chatMessages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface PersistedSessions {
  activeSessionId: string;
  sessions: ChatSession[];
}

let counter = 0;
export const id = (p = 'id') => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
const SESSION_FILE = path.join(process.cwd(), 'server/.data/chats.json');
const IDLE_VIEW: BrowserView = { url: 'about:blank', title: 'New Tab', manual: false, manualReason: undefined, screenshot: undefined };

export class ServerStore {
  private sessions: ChatSession[] = [];
  activeSessionId = '';
  browserView: BrowserView = { ...IDLE_VIEW };
  overlayState: AgentOverlayState = {
    cursorPos: { x: 0.5, y: 0.5 },
    isActive: false,
    hoveredBbox: null,
    isCapturing: false,
  };
  setupProfile: SetupProfile | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.loadSessions();
    this.pruneEmptySessions();
    this.saveSessions();
  }

  get tasks(): Task[] {
    return this.activeSession.tasks;
  }

  get logs(): RunLogEntry[] {
    return this.activeSession.logs;
  }

  get chatMessages(): ChatMessage[] {
    return this.activeSession.chatMessages;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.stateEvent());
    return () => this.listeners.delete(l);
  }

  emit(e: ServerEvent) {
    for (const l of this.listeners) l(e);
  }

  addTask(t: Task) {
    this.tasks.push(t);
    this.tasks.sort((a, b) => a.order_position - b.order_position);
    this.touch();
    this.emit({ type: 'task_added', task: t });
    this.emitSessions();
  }

  updateTask(taskId: string, patch: Partial<Task>) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    Object.assign(t, patch);
    this.touch();
    this.emit({ type: 'task_updated', task: t });
    this.emitSessions();
  }

  removeTask(taskId: string) {
    const before = this.tasks.length;
    this.activeSession.tasks = this.tasks.filter((t) => t.id !== taskId);
    if (this.tasks.length !== before) {
      this.touch();
      this.emit({ type: 'task_removed', taskId });
      this.emitSessions();
    }
  }

  frontPosition(): number {
    return this.tasks.reduce((m, t) => Math.min(m, t.order_position), 0) - 1;
  }

  nextQueued(): Task | null {
    return this.tasks.filter((t) => t.status === 'queued').sort((a, b) => a.order_position - b.order_position)[0] ?? null;
  }

  addLog(entry: RunLogEntry) {
    this.logs.push(entry);
    this.touch();
    this.emit({ type: 'log', entry });
  }

  logsFor(taskId: string): RunLogEntry[] {
    return this.logs.filter((l) => l.taskId === taskId);
  }

  chat(message: ChatMessage) {
    const index = this.chatMessages.findIndex((entry) => entry.id === message.id);
    if (index >= 0) this.chatMessages[index] = message;
    else this.chatMessages.push(message);
    if (message.kind === 'user') this.activeSession.title = titleFromMessage(message.text);
    this.touch();
    this.emit({ type: 'chat', message });
    this.emitSessions();
  }

  modelHistory(): ChatMessage[] {
    return this.chatMessages.filter((message) => message.kind === 'user' || message.kind === 'assistant');
  }

  clearChat() {
    this.activeSession.chatMessages = [];
    this.activeSession.tasks = [];
    this.activeSession.logs = [];
    this.activeSession.title = 'New chat';
    this.touch();
    this.emit({ type: 'clear_chat' });
    this.emitSessions();
  }

  overlay(overlay: AgentOverlayState) {
    this.overlayState = overlay;
    this.emit({ type: 'overlay', overlay });
  }

  browser(view: BrowserView) {
    this.browserView = { ...this.browserView, ...view };
    this.emit({ type: 'browser', view: this.browserView });
  }

  newChat(): boolean {
    this.pruneEmptySessions();
    if (isSessionEmpty(this.activeSession)) {
      this.emit(this.stateEvent());
      this.emitSessions();
      return false;
    }
    const session = createSession();
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.browserView = { ...IDLE_VIEW };
    this.saveSessions();
    this.emit(this.stateEvent());
    this.emitSessions();
    return true;
  }

  switchChat(sessionId: string): boolean {
    this.pruneEmptySessions(sessionId);
    const target = this.sessions.find((session) => session.id === sessionId);
    if (!target) {
      this.emit(this.stateEvent());
      this.emitSessions();
      return false;
    }
    this.activeSessionId = target.id;
    this.browserView = { ...IDLE_VIEW };
    this.saveSessions();
    this.emit(this.stateEvent());
    this.emitSessions();
    return true;
  }

  setHomeView() {
    this.browserView = { ...IDLE_VIEW };
    this.emit({ type: 'browser', view: this.browserView });
  }

  private get activeSession(): ChatSession {
    let session = this.sessions.find((entry) => entry.id === this.activeSessionId);
    if (!session) {
      session = createSession();
      this.sessions = [session];
      this.activeSessionId = session.id;
    }
    return session;
  }

  private stateEvent(): ServerEvent {
    return {
      type: 'state',
      tasks: this.tasks,
      chat: this.chatMessages,
      sessions: this.sessionSummaries(),
      activeSessionId: this.activeSessionId,
      browser: this.browserView,
      overlay: this.overlayState,
      setup: { ready: Boolean(this.setupProfile), ...(this.setupProfile ? { profile: this.setupProfile } : {}) },
    };
  }

  private emitSessions() {
    this.emit({ type: 'sessions', sessions: this.sessionSummaries(), activeSessionId: this.activeSessionId });
  }

  private sessionSummaries(): ChatSessionSummary[] {
    return this.sessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        empty: isSessionEmpty(session),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private touch() {
    this.activeSession.updatedAt = Date.now();
    this.saveSessions();
  }

  private pruneEmptySessions(keepId = this.activeSessionId) {
    this.sessions = this.sessions.filter((session) => session.id === keepId || !isSessionEmpty(session));
    if (!this.sessions.some((session) => session.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0]?.id ?? '';
    }
    if (!this.activeSessionId) {
      const session = createSession();
      this.sessions = [session];
      this.activeSessionId = session.id;
    }
  }

  private loadSessions() {
    try {
      const parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as PersistedSessions;
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      this.activeSessionId = parsed.activeSessionId || this.sessions[0]?.id || '';
    } catch {
      const session = createSession();
      this.sessions = [session];
      this.activeSessionId = session.id;
    }
  }

  private saveSessions() {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    const data: PersistedSessions = { activeSessionId: this.activeSessionId, sessions: this.sessions };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  }
}

export const serverStore = new ServerStore();

function createSession(): ChatSession {
  const now = Date.now();
  return {
    id: id('chat'),
    title: 'New chat',
    tasks: [],
    logs: [],
    chatMessages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function isSessionEmpty(session: ChatSession): boolean {
  return session.tasks.length === 0 && session.logs.length === 0 && session.chatMessages.filter((message) => message.kind !== 'activity').length === 0;
}

function titleFromMessage(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 34 ? `${clean.slice(0, 34).trim()}...` : clean || 'New chat';
}
