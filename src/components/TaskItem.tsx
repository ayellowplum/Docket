import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BlockedKind, Task } from '../../shared/types';
import { useStore } from '../store';

const emptyLogs: never[] = [];

const blockMeta: Record<BlockedKind, { question: string; input?: boolean; secret?: boolean; checkbox?: string; confirm?: string }> = {
  otp: { question: 'Enter the verification code that was sent to you.', input: true },
  captcha: { question: 'Solve the captcha in the browser view, then hit Resume agent.' },
  credential: { question: 'Enter the missing credential.', input: true, secret: true },
  password_setup: {
    question: 'Choose a password to use.',
    input: true,
    secret: true,
    checkbox: 'Use this for all future signups too',
  },
  domain_permission: { question: 'Docket wants to use your saved credentials on this site.', confirm: 'Allow' },
  manual: { question: 'Help with the next small browser action, then resume.' },
  memory: { question: 'What should Docket remember for this?', input: true },
  ambiguous: { question: 'How should I proceed?', input: true },
};

export const TaskItem = forwardRef<
  HTMLDivElement,
  {
    task: Task;
    onResolve: (taskId: string, value: string, applyToAll: boolean, allowDomain?: boolean) => void;
  }
>(function TaskItem({ task, onResolve }, ref) {
  const [value, setValue] = useState('');
  const [applyAll, setApplyAll] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const liveLogs = useStore((state) => state.logs[task.id] ?? emptyLogs);
  const expandable = task.status === 'done' || liveLogs.length > 0;
  const blocked = task.status === 'blocked' && task.blockedKind;
  const meta = blocked ? blockMeta[task.blockedKind!] : null;
  const question = task.blockedReason || meta?.question || 'How should I proceed?';

  useEffect(() => {
    if (blocked) inputRef.current?.focus({ preventScroll: true });
  }, [blocked]);

  function submit() {
    if (!value.trim()) return;
    onResolve(task.id, value.trim(), applyAll);
    setValue('');
  }

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`task ${task.status} ${expandable ? 'expandable' : ''}`}
    >
      {task.status === 'running' && <span className="task-loader" aria-hidden />}
      <div
        className="task-row"
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? resultOpen : undefined}
        onClick={() => expandable && setResultOpen((open) => !open)}
        onKeyDown={(event) => {
          if (expandable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setResultOpen((open) => !open);
          }
        }}
      >
        <div className="task-main">
          <div className="task-headline">
            <span className="task-title">{task.title}</span>
            {task.status === 'done' && task.summary && (
              <motion.span
                className="task-summary"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                {renderAnnotatedText(task.summary)}
              </motion.span>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {resultOpen && (task.result || liveLogs.length > 0) && (
          <motion.div
            className="task-result"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.34, ease: 'easeOut' }, opacity: { duration: 0.2 } }}
            onClick={(event) => event.stopPropagation()}
          >
            {task.result?.summary && <p>{renderAnnotatedText(task.result.summary)}</p>}
            {((task.result?.details.length ?? 0) > 0 || liveLogs.length > 0) && (
              <ol>
                {(task.result?.details ?? liveLogs.map((entry) => entry.note)).map((detail, index) => (
                  <li key={`${index}-${detail}`}>{renderAnnotatedText(detail)}</li>
                ))}
              </ol>
            )}
            {task.result && task.result.files.length > 0 && (
              <div className="result-files">
                <span className="result-files-title">Files</span>
                {task.result.files.map((file) => (
                  <a key={file.id} href={file.url} download>
                    <span>{file.name}</span>
                    <small>{formatBytes(file.size)}</small>
                  </a>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {blocked && (
          <motion.div
            className="block-banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div className="block-q">{question}</div>
            {meta?.input && (
              <div className="block-box">
                <input
                  ref={inputRef}
                  type={meta.secret ? 'password' : 'text'}
                  value={value}
                  placeholder="Type your answer…"
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <button
                  className={`block-send ${value.trim() ? '' : 'idle-empty'}`}
                  aria-label="Submit"
                  onClick={submit}
                >
                  ↑
                </button>
              </div>
            )}
            {meta?.confirm && (
              <button className="block-allow" onClick={() => onResolve(task.id, 'allow', applyAll, true)}>
                {meta.confirm}
              </button>
            )}
            {meta?.checkbox && (
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={applyAll}
                  onChange={(e) => setApplyAll(e.target.checked)}
                />
                {meta.checkbox}
              </label>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAnnotatedText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span className="result-note" tabIndex={0} key={`${match.index}-${match[1]}`}>
        {match[1]}
        <span className="result-note-pop">{match[2]}</span>
      </span>
    );
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}
