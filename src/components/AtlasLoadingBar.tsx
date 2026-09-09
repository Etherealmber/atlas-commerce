import { useEffect, useRef, useState } from 'react';

/**
 * Top progress bar inspired by ngx-loading-bar, styled for Atlas Commerce
 * (zellij teal, soft trail). Controlled via window events:
 *   atlas-loading:start | atlas-loading:set | atlas-loading:done
 */
type Phase = 'idle' | 'running' | 'finishing';

export function startAtlasLoading() {
  window.dispatchEvent(new CustomEvent('atlas-loading:start'));
}
export function setAtlasLoading(pct: number) {
  window.dispatchEvent(new CustomEvent('atlas-loading:set', { detail: { pct } }));
}
export function doneAtlasLoading() {
  window.dispatchEvent(new CustomEvent('atlas-loading:done'));
}

export default function AtlasLoadingBar() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onStart = () => {
      setPhase('running');
      setPct(8);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        setPct((p) => {
          if (p >= 92) return p;
          const step = p < 40 ? 4 : p < 70 ? 2 : 0.6;
          return Math.min(92, p + step);
        });
      }, 320);
    };
    const onSet = (e: Event) => {
      const n = (e as CustomEvent).detail?.pct;
      if (typeof n === 'number') {
        setPhase('running');
        setPct(Math.max(0, Math.min(100, n)));
      }
    };
    const onDone = () => {
      if (timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
      setPct(100);
      setPhase('finishing');
      window.setTimeout(() => {
        setPhase('idle');
        setPct(0);
      }, 280);
    };
    window.addEventListener('atlas-loading:start', onStart);
    window.addEventListener('atlas-loading:set', onSet);
    window.addEventListener('atlas-loading:done', onDone);
    return () => {
      window.removeEventListener('atlas-loading:start', onStart);
      window.removeEventListener('atlas-loading:set', onSet);
      window.removeEventListener('atlas-loading:done', onDone);
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  if (phase === 'idle') return null;

  return (
    <div className="atlas-loading-bar" aria-hidden>
      <div
        className={`atlas-loading-bar-peg${phase === 'finishing' ? ' is-done' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
