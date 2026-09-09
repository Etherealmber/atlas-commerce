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
  pupilColor = 'black',
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
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDistance);
    const angle = Math.atan2(dy, dx);
    px = Math.cos(angle) * dist;
    py = Math.sin(angle) * dist;
  }

  return (
    <div
      ref={eyeRef}
      className={`atlas-eyeball${isSad ? ' atlas-eyeball--sad' : ''}`}
      style={{
        width: size,
        height: isBlinking ? 2 : isSad ? size * 0.5 : size,
        backgroundColor: eyeColor,
        borderRadius: isSad ? `0 0 ${size}px ${size}px` : '50%',
        transform: isSad ? `rotate(${sadRotate}deg)` : 'rotate(0deg)',
      }}
    >
      {!isBlinking && (
        <div
          className="atlas-eyeball-pupil"
          style={{
            width: pupilSize,
            height: pupilSize,
            backgroundColor: pupilColor,
            transform: `translate(${px}px, ${isSad ? -1 : py}px)`,
          }}
        />
      )}
    </div>
  );
}
