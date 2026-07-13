export type TaskStatus = 'queued' | 'running' | 'blocked' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  order_position: number;
  summary?: string;
  result?: TaskResult;
  blockedReason?: string;
  blockedKind?: BlockedKind;
  createdAt: number;
}

export interface TaskResultFile {
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface TaskResult {
  summary: string;
  details: string[];
  files: TaskResultFile[];
}

export interface SetupProfile {
  name: string;
  email: string;
}

export type BlockedKind =
  | 'otp'
  | 'captcha'
  | 'credential'
  | 'password_setup'
  | 'domain_permission'
  | 'ambiguous';

// ---- Chat ----
export type ChatKind = 'user' | 'assistant' | 'activity';

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  text: string;
  state?: 'working' | 'done';
  detail?: string;
  createdAt: number;
  pending?: boolean;
}

export type ChatAction =
  | { type: 'add_task'; title: string; priority?: 'high' | 'normal' }
  | { type: 'remove_task'; query: string }
  | { type: 'prioritize_task'; query: string }
  | { type: 'list_tasks' }
  | { type: 'clear_tasks' }
  | { type: 'run' };

export interface ChatResult {
  reply: string;
  actions: ChatAction[];
}

// ---- Browser agent ----
export interface ManifestElement {
  id: number;
  role: string;
  label: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export type AgentAction =
  | { type: 'click'; id: number }
  | { type: 'type'; id: number; value: string }
  | { type: 'press'; key: BrowserKey }
  | { type: 'fill_field'; id: number; field: FieldType }
  | { type: 'scroll'; to?: number; direction?: 'up' | 'down' }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; ms: number }
  | { type: 'done'; note?: string }
  | { type: 'blocked'; reason: string; kind: BlockedKind };

export type BrowserKey =
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Backspace'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Meta+A'
  | 'Control+A'
  | 'Meta+L'
  | 'Control+L';

export type FieldType = 'email' | 'password' | 'name' | 'phone' | 'address';

export interface RunLogEntry {
  taskId: string;
  step: number;
  action: string;
  note: string;
  at: number;
}

export interface AgentOverlayState {
  cursorPos: { x: number; y: number };
  isActive: boolean;
  hoveredBbox: { x: number; y: number; width: number; height: number } | null;
  isCapturing: boolean;
}

export interface BrowserView {
  url: string;
  title: string;
  loading?: boolean;
  screenshot?: string;
  manual?: boolean;
  manualReason?: string;
}

// ---- WebSocket protocol ----
export type ServerEvent =
  | { type: 'state'; tasks: Task[]; chat: ChatMessage[]; browser: BrowserView; overlay: AgentOverlayState; setup: { ready: boolean; profile?: SetupProfile } }
  | { type: 'task_added'; task: Task }
  | { type: 'task_updated'; task: Task }
  | { type: 'task_removed'; taskId: string }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'overlay'; overlay: AgentOverlayState }
  | { type: 'browser'; view: BrowserView }
  | { type: 'log'; entry: RunLogEntry }
  | { type: 'clear_chat' }
  | { type: 'setup_ready'; profile: SetupProfile }
  | { type: 'setup_error'; message: string };

export type ClientCommand =
  | { type: 'message'; text: string }
  | { type: 'resolve_block'; taskId: string; value: string; applyToAll?: boolean; allowDomain?: boolean }
  | { type: 'new_chat' }
  | { type: 'browser_pointer'; x: number; y: number }
  | { type: 'browser_key'; key: string; text?: string }
  | { type: 'resume_agent' }
  | { type: 'setup'; name: string; email: string; apiKey: string };
