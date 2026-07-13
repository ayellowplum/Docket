import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { useStore } from '../store';
import { ActivityOverlay } from './ActivityOverlay';
import { send } from '../lib/ws';

function StandbyScreen() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="standby-ui">
      <div className="standby-clock">
        {pad(now.getHours())}:{pad(now.getMinutes())}
        <span className="sec">:{pad(now.getSeconds())}</span>
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function computeFocus(
  hb: { x: number; y: number; width: number; height: number } | null,
  active: boolean
): { zoom: number; transform: string } {
  if (!hb || !active) return { zoom: 1, transform: 'translate(0%, 0%) scale(1)' };
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  const maxFrac = Math.max(hb.width, hb.height, 0.06);
  const zoom = clamp(0.42 / maxFrac, 1, 3);
  const tx = clamp(0.5 - cx * zoom, 1 - zoom, 0);
  const ty = clamp(0.5 - cy * zoom, 1 - zoom, 0);
  return { zoom, transform: `translate(${tx * 100}%, ${ty * 100}%) scale(${zoom})` };
}

export function BrowserView() {
  const browser = useStore((s) => s.browser);
  const overlay = useStore((s) => s.overlay);
  const tasks = useStore((s) => s.tasks);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [linger, setLinger] = useState(false);

  const active = tasks.some((task) => task.status === 'running' || task.status === 'blocked') || Boolean(browser.manual);
  const on = Boolean(browser.screenshot) && (active || linger);

  const { zoom, transform } = computeFocus(overlay.hoveredBbox, overlay.isActive);

  useEffect(() => {
    if (active) {
      setLinger(true);
      return;
    }
    const timer = setTimeout(() => setLinger(false), 1000);
    return () => clearTimeout(timer);
  }, [active, browser.screenshot]);

  return (
    <div className={`tv ${on ? 'on' : 'off'}`}>
      <div className="tv-bar">
        {on && (
          <button className="tv-home" aria-label="Go home" title="Google home" onClick={() => send({ type: 'browser_home' })}>
            <Home size={13} strokeWidth={1.8} />
          </button>
        )}
        <span className="tv-url">{on ? browser.url : ''}</span>
        {browser.loading && <span className="caret" />}
        <span className="sp" />
      </div>

      <div className={`screen ${on ? 'on' : 'off'}`}>
        <AnimatePresence mode="wait">
          {on ? (
            <motion.div
              key="page"
              className="page-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <div className="viewport" ref={viewportRef}>
                <div
                  className="stage-inner"
                  style={{ transform, ['--zoom' as string]: zoom } as CSSProperties}
                >
                  <img className="shot" src={browser.screenshot} alt="" draggable={false} />
                  <ActivityOverlay />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="static"
              className="static-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <StandbyScreen />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="scanlines" />
        {on && browser.manual && (
          <div
            className="manual-input"
            role="application"
            tabIndex={0}
            aria-label="Interactive browser"
            onPointerDown={(event) => {
              const rect = viewportRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
              send({
                type: 'browser_pointer',
                x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
                y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
              });
              event.currentTarget.focus();
            }}
            onKeyDown={(event) => {
              event.preventDefault();
              const modifier = event.metaKey ? 'Meta+' : event.ctrlKey ? 'Control+' : '';
              if (event.key.length === 1 && !modifier) send({ type: 'browser_key', key: '', text: event.key });
              else send({ type: 'browser_key', key: `${modifier}${event.key}` });
            }}
          />
        )}
      </div>
      {browser.manual && (
        <div className="manual-bar">
          <span>{browser.manualReason || 'Manual action needed'}</span>
          <button onClick={() => send({ type: 'resume_agent' })}>Resume agent</button>
        </div>
      )}
    </div>
  );
}
