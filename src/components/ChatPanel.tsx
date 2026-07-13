import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, SquarePen } from 'lucide-react';
import type { ChatMessage } from '../../shared/types';
import { useStore } from '../store';
import { send } from '../lib/ws';

function renderBold(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function formatted(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {renderBold(line)}
    </span>
  ));
}

function ActivityLine({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);

  if (m.state === 'working') {
    return (
      <motion.div layout className="activity working" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="a-text">{m.text}</span>
        <span className="a-ell" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </motion.div>
    );
  }

  if (m.state === 'done') {
    const expandable = Boolean(m.detail);
    return (
      <motion.div layout className={`activity done ${expandable ? 'expandable' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="a-head" onClick={() => expandable && setOpen((o) => !o)}>
          <span className="a-text">{m.text}</span>
        </div>
        <AnimatePresence initial={false}>
          {open && m.detail && (
            <motion.div
              className="a-detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              <div className="a-detail-inner">{formatted(m.detail)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="activity action" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ duration: 0.3 }}>
      {m.text}
    </motion.div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.kind === 'activity') return <ActivityLine m={m} />;

  return (
    <motion.div
      layout
      className={`msg ${m.kind}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut' }}
    >
      {m.pending ? (
        <span className="typing-dots">
          <i />
          <i />
          <i />
        </span>
      ) : (
        formatted(m.text)
      )}
    </motion.div>
  );
}

export function ChatPanel({ onSend }: { onSend: (text: string) => void }) {
  const chat = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, chat[chat.length - 1]?.pending, chat[chat.length - 1]?.state]);

  function submit() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
  }

  const canSend = text.trim().length > 0;

  return (
    <div className="chat">
      <div className="chat-head">
        <h1 className="wordmark">Docket</h1>
        <button className="new-chat" aria-label="New chat" title="New chat" onClick={() => send({ type: 'new_chat' })}>
          <SquarePen size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="chat-log scroll" ref={logRef}>
        {chat.length === 0 && (
          <motion.div
            className="chat-empty"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            What needs doing?
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </AnimatePresence>
      </div>

      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Message Docket…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className={`act ${canSend ? '' : 'idle-empty'}`} onClick={submit} aria-label="Send">
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
