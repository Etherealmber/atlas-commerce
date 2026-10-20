import { useEffect, useRef, useState } from 'react';

type Props = {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
  isSad?: boolean;
  sadRotate?: number;
};

export default function EyeBall({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = 'white',
  pupilColor = '#0a0a0a',
  isBlinking = false,
  forceLookX,
  forceLookY,
  isSad = false,
  sadRotate = 0,
}: Props) {
  const eyeRef = useRef<HTMLDivElement>(null);
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
  } else if (eyeRef.current) {
    const eye = eyeRef.current.getBoundingClientRect();
    const cx = eye.left + eye.width / 2;
    const cy = eye.top + eye.height / 2;
    const dx = mouse.x - cx;
    const dy = mouse.y - cy;
    const max = Math.max(2, maxDistance);
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), max);
    const angle = Math.atan2(dy, dx);
    px = Math.cos(angle) * dist;
    py = Math.sin(angle) * dist;
  }

  const h = isBlinking ? Math.max(3, size * 0.08) : isSad ? size * 0.45 : size;
  const r = isSad ? `0 0 ${size}px ${size}px` : '50%';

  return (
    <div
      ref={eyeRef}
      className={`atlas-eyeball${isSad ? ' atlas-eyeball--sad' : ''}${isBlinking ? ' atlas-eyeball--blink' : ''}`}
      style={{
        width: size,
        height: h,
        backgroundColor: eyeColor,
        borderRadius: r,
        transform: isSad ? `rotate(${sadRotate}deg)` : undefined,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.12)',
        transition: 'height 0.12s ease, border-radius 0.12s ease',
      }}
    >
      {!isBlinking && (
        <div
          className="atlas-eyeball-pupil"
          style={{
            width: pupilSize,
            height: pupilSize,
            borderRadius: '50%',
            backgroundColor: pupilColor,
            position: 'absolute',
            left: '50%',
            top: '50%',
            marginLeft: -pupilSize / 2,
            marginTop: -pupilSize / 2,
            transform: `translate(${px}px, ${isSad ? Math.min(py, 0) : py}px)`,
            transition: 'transform 0.08s linear',
            boxShadow: `inset -${Math.max(2, pupilSize * 0.18)}px -${Math.max(2, pupilSize * 0.15)}px 0 rgba(255,255,255,0.25)`,
          }}
        />
      )}
    </div>
  );
}
