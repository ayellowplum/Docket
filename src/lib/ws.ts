import type { ClientCommand, ServerEvent } from '../../shared/types';
import { useStore } from '../store';
import { DEFAULT_BACKEND_PORT } from '../../shared/config';

let socket: WebSocket | null = null;
const RECONNECT_MS = 1000;

function backendUrl(): string {
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BACKEND_PORT || DEFAULT_BACKEND_PORT;
    return `ws://${location.hostname}:${port}/ws`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function connectBackend() {
  if (socket) return;
  try {
    socket = new WebSocket(backendUrl());
  } catch {
    return;
  }

  socket.onopen = () => {
    useStore.getState().setConnected(true);
  };

  socket.onmessage = (ev) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(ev.data);
    } catch {
      return;
    }
    applyEvent(event);
  };

  socket.onclose = () => {
    socket = null;
    useStore.getState().setConnected(false);
    setTimeout(connectBackend, RECONNECT_MS);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

export function isBackendLive(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function send(cmd: ClientCommand) {
  if (isBackendLive()) socket!.send(JSON.stringify(cmd));
}

function applyEvent(e: ServerEvent) {
  const s = useStore.getState();
  switch (e.type) {
    case 'state':
      s.setTasks(e.tasks);
      s.clearChat();
      e.chat.forEach(s.addChat);
      s.setBrowser(e.browser);
      s.setOverlay(e.overlay);
      s.setSetup(e.setup.ready, e.setup.profile ?? null);
      break;
    case 'task_added':
    case 'task_updated':
      s.upsertTask(e.task);
      break;
    case 'task_removed':
      s.removeTasks([e.taskId]);
      break;
    case 'chat':
      s.addChat(e.message);
      break;
    case 'overlay':
      s.setOverlay(e.overlay);
      break;
    case 'browser':
      s.setBrowser(e.view);
      break;
    case 'log':
      s.addLog(e.entry);
      break;
    case 'clear_chat':
      s.clearChat();
      break;
    case 'setup_ready':
      s.setSetup(true, e.profile);
      break;
    case 'setup_error':
      s.setSetupError(e.message);
      break;
  }
}
