import { useEffect, useRef, useState } from 'react';

type Props = {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
  isBlinking?: boolean;
};

/** Standalone pupil (used on faces without full EyeBall). Always centered + look offset. */
export default function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = '#0a0a0a',
  forceLookX,
  forceLookY,
  isBlinking = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  let px = 0;
  let py = 0;
  if (forceLookX !== undefined && forceLookY !== undefined) {
    px = forceLookX;
    py = forceLookY;
  } else if (ref.current) {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = mouse.x - cx;
    const dy = mouse.y - cy;
    const max = Math.max(2, maxDistance);
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), max);
    const angle = Math.atan2(dy, dx);
    px = Math.cos(angle) * dist;
    py = Math.sin(angle) * dist;
  }

  if (isBlinking) {
    return (
      <div
        className="atlas-pupil-dot atlas-pupil-dot--blink"
        style={{
          width: size,
          height: 2,
          backgroundColor: pupilColor,
          borderRadius: 999,
        }}
      />
    );
  }

  return (
    <div
      ref={ref}
      className="atlas-pupil-dot"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: pupilColor,
        transform: `translate(${px}px, ${py}px)`,
        transition: 'transform 0.08s linear',
        boxShadow: `inset -${Math.max(1, size * 0.2)}px -${Math.max(1, size * 0.15)}px 0 rgba(255,255,255,0.28)`,
        flexShrink: 0,
      }}
    />
  );
}
