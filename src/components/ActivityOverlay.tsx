import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store';

export function ActivityOverlay() {
  const overlay = useStore((s) => s.overlay);

  return (
    <div className="overlay-layer">
      <AnimatePresence>
        {overlay.hoveredBbox && (
          <motion.div
            className="hover-outline"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{
              left: `${overlay.hoveredBbox.x * 100}%`,
              top: `${overlay.hoveredBbox.y * 100}%`,
              width: `${overlay.hoveredBbox.width * 100}%`,
              height: `${overlay.hoveredBbox.height * 100}%`,
            }}
          />
        )}
      </AnimatePresence>

      <div
        className={`ai-cursor ${overlay.isActive ? 'active' : 'idle'}`}
        style={{
          left: `${overlay.cursorPos.x * 100}%`,
          top: `${overlay.cursorPos.y * 100}%`,
        }}
      />

      <AnimatePresence>
        {overlay.isCapturing && (
          <motion.div
            className="capture-flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
