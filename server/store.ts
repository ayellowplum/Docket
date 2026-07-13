import type {
  AgentOverlayState,
  BrowserView,
  ChatMessage,
  RunLogEntry,
  ServerEvent,
  Task,
  SetupProfile,
} from '../shared/types.ts';

type Listener = (e: ServerEvent) => void;

let counter = 0;
export const id = (p = 'id') => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export class ServerStore {
  tasks: Task[] = [];
  logs: RunLogEntry[] = [];
  chatMessages: ChatMessage[] = [];
  browserView: BrowserView = { url: 'about:blank', title: 'New Tab', manual: false };
  overlayState: AgentOverlayState = {
    cursorPos: { x: 0.5, y: 0.5 },
    isActive: false,
    hoveredBbox: null,
    isCapturing: false,
  };
  setupProfile: SetupProfile | null = null;
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l({
      type: 'state',
      tasks: this.tasks,
      chat: this.chatMessages,
      browser: this.browserView,
      overlay: this.overlayState,
      setup: { ready: Boolean(this.setupProfile), ...(this.setupProfile ? { profile: this.setupProfile } : {}) },
    });
    return () => this.listeners.delete(l);
  }

  emit(e: ServerEvent) {
    for (const l of this.listeners) l(e);
  }

  addTask(t: Task) {
    this.tasks.push(t);
    this.tasks.sort((a, b) => a.order_position - b.order_position);
    this.emit({ type: 'task_added', task: t });
  }

  updateTask(taskId: string, patch: Partial<Task>) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    Object.assign(t, patch);
    this.emit({ type: 'task_updated', task: t });
  }

  removeTask(taskId: string) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    if (this.tasks.length !== before) this.emit({ type: 'task_removed', taskId });
  }

  frontPosition(): number {
    return this.tasks.reduce((m, t) => Math.min(m, t.order_position), 0) - 1;
  }

  nextQueued(): Task | null {
    return this.tasks.filter((t) => t.status === 'queued').sort((a, b) => a.order_position - b.order_position)[0] ?? null;
  }

  addLog(entry: RunLogEntry) {
    this.logs.push(entry);
    this.emit({ type: 'log', entry });
  }

  logsFor(taskId: string): RunLogEntry[] {
    return this.logs.filter((l) => l.taskId === taskId);
  }

  chat(message: ChatMessage) {
    const index = this.chatMessages.findIndex((entry) => entry.id === message.id);
    if (index >= 0) this.chatMessages[index] = message;
    else this.chatMessages.push(message);
    this.emit({ type: 'chat', message });
  }

  modelHistory(): ChatMessage[] {
    return this.chatMessages.filter((message) => message.kind === 'user' || message.kind === 'assistant');
  }

  clearChat() {
    this.chatMessages = [];
    this.emit({ type: 'clear_chat' });
  }

  overlay(overlay: AgentOverlayState) {
    this.overlayState = overlay;
    this.emit({ type: 'overlay', overlay });
  }

  browser(view: BrowserView) {
    this.browserView = { ...this.browserView, ...view };
    this.emit({ type: 'browser', view: this.browserView });
  }
}

export const serverStore = new ServerStore();
