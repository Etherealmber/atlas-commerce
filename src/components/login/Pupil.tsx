import { useEffect, useRef, useState } from 'react';

type Props = {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
  isBlinking?: boolean;
};

export default function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = 'black',
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
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDistance);
    const angle = Math.atan2(dy, dx);
    px = Math.cos(angle) * dist;
    py = Math.sin(angle) * dist;
  }

  return (
    <div
      ref={ref}
      className="atlas-pupil-dot"
      style={{
        width: size,
        height: isBlinking ? 2 : size,
        backgroundColor: pupilColor,
        transform: `translate(${px}px, ${py}px)`,
      }}
    />
  );
}
