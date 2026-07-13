import { AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import { TaskItem } from './TaskItem';
import { send } from '../lib/ws';

export function TaskList() {
  const tasks = useStore((s) => s.tasks);

  const remaining = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;

  function handleResolve(taskId: string, value: string, applyAll: boolean) {
    send({ type: 'resolve_block', taskId, value, applyToAll: applyAll, allowDomain: true });
  }

  return (
    <div className="tasklist">
      <div className="tasklist-head">
        <span className="label">Tasks</span>
        {tasks.length > 0 && <span className="count">{remaining}</span>}
      </div>

      <div className="tasks-scroll scroll">
        {tasks.length === 0 && <div className="tasks-empty">Nothing queued yet.</div>}
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} onResolve={handleResolve} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
