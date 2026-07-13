import { useEffect } from 'react';
import './styles/components.css';
import { useStore, uid } from './store';
import { ChatPanel } from './components/ChatPanel';
import { TaskList } from './components/TaskList';
import { BrowserView } from './components/BrowserView';
import { connectBackend, isBackendLive, send } from './lib/ws';
import { SetupScreen } from './components/SetupScreen';

export function App() {
  const setupReady = useStore((state) => state.setupReady);
  useEffect(() => {
    connectBackend();
  }, []);

  function handleSend(text: string) {
    const s = useStore.getState();
    if (!isBackendLive()) return;

    s.addChat({ id: uid('c'), kind: 'assistant', text: '', createdAt: Date.now(), pending: true });
    send({ type: 'message', text });
  }

  if (!setupReady) return <SetupScreen />;

  return (
    <div className="app">
      <ChatPanel onSend={handleSend} />
      <div className="right">
        <BrowserView />
        <TaskList />
      </div>
    </div>
  );
}
