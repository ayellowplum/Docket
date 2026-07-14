import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { send } from '../lib/ws';

export function SetupScreen() {
  const connected = useStore((state) => state.connected);
  const error = useStore((state) => state.setupError);
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('docket.setup') || '{}'); } catch { return {}; }
  })() as { name?: string; email?: string; apiKey?: string };
  const [name, setName] = useState(saved.name ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [apiKey, setApiKey] = useState(saved.apiKey ?? '');
  const restored = useRef(false);
  const hasSavedSetup = useRef(Boolean(saved.name && saved.email && saved.apiKey));

  useEffect(() => {
    if (connected && hasSavedSetup.current && !restored.current) {
      restored.current = true;
      send({ type: 'setup', name, email, apiKey });
    }
  }, [connected, name, email, apiKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!connected || !name.trim() || !email.trim() || !apiKey.trim()) return;
    localStorage.setItem('docket.setup', JSON.stringify({ name: name.trim(), email: email.trim(), apiKey: apiKey.trim() }));
    send({ type: 'setup', name, email, apiKey });
  }

  return (
    <main className="setup-shell">
      <form className="setup-card" onSubmit={submit}>
        <h1>Docket</h1>
        <div className="setup-intro">
          <p>{connected ? 'A few details, then you’re ready.' : 'Connecting…'}</p>
          {connected && (
            <span className="setup-help" tabIndex={0} aria-label="Why Docket needs this information">
              ?
              <span role="tooltip">Docket uses your name and email as your identity when it fills forms for you.</span>
            </span>
          )}
        </div>
        <label>Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Docket access key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
        {error && <div className="setup-error">{error}</div>}
        <button disabled={!connected || !name.trim() || !email.trim() || !apiKey.trim()}>Continue</button>
      </form>
    </main>
  );
}
