import { create } from 'zustand';
import type {
  AgentOverlayState,
  BrowserView,
  ChatMessage,
  RunLogEntry,
  Task,
} from '../shared/types';

let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export interface DocketState {
  tasks: Task[];
  chat: ChatMessage[];
  overlay: AgentOverlayState;
  browser: BrowserView;
  logs: Record<string, RunLogEntry[]>;
  connected: boolean;
  setupReady: boolean;
  setupError: string | null;
  profile: { name: string; email: string } | null;
  activeTaskId: string | null;

  setTasks: (t: Task[]) => void;
  upsertTask: (t: Task) => void;
  removeTasks: (ids: string[]) => void;
  addChat: (m: ChatMessage) => void;
  clearChat: () => void;
  setOverlay: (patch: Partial<AgentOverlayState>) => void;
  setBrowser: (patch: Partial<BrowserView>) => void;
  addLog: (e: RunLogEntry) => void;
  setConnected: (c: boolean) => void;
  setSetup: (ready: boolean, profile?: { name: string; email: string } | null) => void;
  setSetupError: (message: string | null) => void;
}

export const useStore = create<DocketState>((set) => ({
  tasks: [],
  chat: [],
  overlay: {
    cursorPos: { x: 0.5, y: 0.5 },
    isActive: false,
    hoveredBbox: null,
    isCapturing: false,
  },
  browser: { url: 'about:blank', title: 'New Tab' },
  logs: {},
  connected: false,
  setupReady: false,
  setupError: null,
  profile: null,
  activeTaskId: null,

  setTasks: (tasks) =>
    set({
      tasks: [...tasks].sort((a, b) => a.order_position - b.order_position),
      activeTaskId: tasks.find((t) => t.status === 'running')?.id ?? null,
    }),

  upsertTask: (task) =>
    set((s) => {
      const exists = s.tasks.some((t) => t.id === task.id);
      const tasks = (exists
        ? s.tasks.map((t) => (t.id === task.id ? task : t))
        : [...s.tasks, task]
      ).sort((a, b) => a.order_position - b.order_position);
      return { tasks, activeTaskId: tasks.find((t) => t.status === 'running')?.id ?? null };
    }),

  removeTasks: (ids) =>
    set((s) => ({ tasks: s.tasks.filter((t) => !ids.includes(t.id)) })),

  addChat: (m) =>
    set((s) => {
      let chat = m.pending ? s.chat : s.chat.filter((x) => !x.pending);
      const i = chat.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        chat = chat.slice();
        chat[i] = m;
      } else {
        chat = [...chat, m];
      }
      return { chat };
    }),

  clearChat: () => set({ chat: [] }),

  setOverlay: (patch) => set((s) => ({ overlay: { ...s.overlay, ...patch } })),

  setBrowser: (patch) => set((s) => ({ browser: { ...s.browser, ...patch } })),

  addLog: (e) =>
    set((s) => ({
      logs: { ...s.logs, [e.taskId]: [...(s.logs[e.taskId] ?? []), e] },
    })),

  setConnected: (connected) => set({ connected }),
  setSetup: (setupReady, profile = null) => set({ setupReady, profile, setupError: null }),
  setSetupError: (setupError) => set({ setupError, setupReady: false }),
}));
