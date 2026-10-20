import { useEffect, useRef, useState, useCallback } from 'react';
import EyeBall from './EyeBall';
import Pupil from './Pupil';

type Props = {
  isTyping?: boolean;
  showPassword?: boolean;
  passwordLength?: number;
  loginFailed?: boolean;
  loginSuccess?: boolean;
};

type Pos = { faceX: number; faceY: number; bodySkew: number };

function calcPos(
  cx: number,
  cy: number,
  mx: number,
  my: number,
  rangeX = 15,
  rangeY = 10,
  minX?: number,
  maxX?: number,
  minY?: number,
  maxY?: number
): Pos {
  const rMinX = minX ?? -rangeX;
  const rMaxX = maxX ?? rangeX;
  const rMinY = minY ?? -rangeY;
  const rMaxY = maxY ?? rangeY;
  const dx = mx - cx;
  const dy = my - cy;
  const scaleX = Math.max(Math.abs(rMinX), Math.abs(rMaxX));
  const scaleY = Math.max(Math.abs(rMinY), Math.abs(rMaxY));
  const faceX = Math.max(rMinX, Math.min(rMaxX, dx / (300 / scaleX)));
  const faceY = Math.max(rMinY, Math.min(rMaxY, dy / (300 / scaleY)));
  const bodySkew = Math.max(-6, Math.min(6, -dx / 120));
  return { faceX, faceY, bodySkew };
}

export default function AnimatedCharacters({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
  loginFailed = false,
  loginSuccess = false,
}: Props) {
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);

  const [hasEntered, setHasEntered] = useState(false);
  const [purpleBlink, setPurpleBlink] = useState(false);
  const [blackBlink, setBlackBlink] = useState(false);
  const [orangeBlink, setOrangeBlink] = useState(false);
  const [yellowBlink, setYellowBlink] = useState(false);
  const [lookingEachOther, setLookingEachOther] = useState(false);
  const [purplePeek, setPurplePeek] = useState(false);
  const [purplePos, setPurplePos] = useState<Pos>({ faceX: 0, faceY: 0, bodySkew: 0 });
  const [blackPos, setBlackPos] = useState<Pos>({ faceX: 0, faceY: 0, bodySkew: 0 });
  const [orangePos, setOrangePos] = useState<Pos>({ faceX: 0, faceY: 0, bodySkew: 0 });
  const [yellowPos, setYellowPos] = useState<Pos>({ faceX: 0, faceY: 0, bodySkew: 0 });
  const [confetti, setConfetti] = useState<{ style: React.CSSProperties; key: number }[]>([]);
  const [successLookY, setSuccessLookY] = useState(-5);

  const centers = useRef({
    purple: { x: 0, y: 0 },
    black: { x: 0, y: 0 },
    orange: { x: 0, y: 0 },
    yellow: { x: 0, y: 0 },
  });
  const pending = useRef({ x: 0, y: 0, need: false });
  const isHiding = passwordLength > 0 && !showPassword;
  const peekingPwd = passwordLength > 0 && showPassword;

  const updateCenters = useCallback(() => {
    const map = [
      ['purple', purpleRef],
      ['black', blackRef],
      ['orange', orangeRef],
      ['yellow', yellowRef],
    ] as const;
    for (const [k, r] of map) {
      if (r.current) {
        const rect = r.current.getBoundingClientRect();
        centers.current[k] = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 };
      }
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pending.current = { x: e.clientX, y: e.clientY, need: true };
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('resize', updateCenters, { passive: true });

    let raf = 0;
    const loop = () => {
      if (pending.current.need && hasEntered) {
        pending.current.need = false;
        const { x, y } = pending.current;
        const c = centers.current;
        setPurplePos(calcPos(c.purple.x, c.purple.y, x, y, 30, 20));
        setBlackPos(calcPos(c.black.x, c.black.y, x, y));
        setOrangePos(calcPos(c.orange.x, c.orange.y, x, y, 0, 0, -46, 20, -18, 20));
        setYellowPos(calcPos(c.yellow.x, c.yellow.y, x, y));
      }
      raf = requestAnimationFrame(loop);
    };

    const enterT = window.setTimeout(() => {
      setHasEntered(true);
      updateCenters();
      raf = requestAnimationFrame(loop);
    }, 1400);

    const blink = (setB: (v: boolean) => void) => {
      let t: number;
      const schedule = () => {
        t = window.setTimeout(() => {
          setB(true);
          window.setTimeout(() => {
            setB(false);
            schedule();
          }, 150);
        }, Math.random() * 4000 + 3000);
      };
      schedule();
      return () => clearTimeout(t);
    };
    const c1 = blink(setPurpleBlink);
    const c2 = blink(setBlackBlink);
    const c3 = blink(setOrangeBlink);
    const c4 = blink(setYellowBlink);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', updateCenters);
      clearTimeout(enterT);
      cancelAnimationFrame(raf);
      c1();
      c2();
      c3();
      c4();
    };
  }, [hasEntered, updateCenters]);

  useEffect(() => {
    if (isTyping) {
      setLookingEachOther(true);
      const t = window.setTimeout(() => setLookingEachOther(false), 800);
      return () => clearTimeout(t);
    }
    setLookingEachOther(false);
  }, [isTyping]);

  useEffect(() => {
    if (passwordLength > 0 && showPassword && !purplePeek) {
      const t = window.setTimeout(() => {
        setPurplePeek(true);
        window.setTimeout(() => setPurplePeek(false), 800);
      }, Math.random() * 3000 + 2000);
      return () => clearTimeout(t);
    }
    if (passwordLength === 0 || !showPassword) setPurplePeek(false);
  }, [passwordLength, showPassword, purplePeek]);

  useEffect(() => {
    if (!loginSuccess) {
      setSuccessLookY(-5);
      return;
    }
    const colors = ['#FF6B6B', '#71717a', '#FFE66D', '#A78BFA', '#FF9B6B', '#71717a', '#4D96FF'];
    setConfetti(
      Array.from({ length: 120 }, (_, i) => ({
        key: i,
        style: {
          left: `${Math.random() * 100}%`,
          top: `-${10 + Math.random() * 30}%`,
          backgroundColor: colors[i % colors.length],
          width: `${4 + Math.random() * 6}px`,
          height: `${8 + Math.random() * 12}px`,
          animationDelay: `${Math.random() * 2}s`,
          animationDuration: `${4.5 + Math.random() * 2}s`,
          transform: `rotate(${Math.random() * 360}deg)`,
        } as React.CSSProperties,
      }))
    );
    const start = performance.now();
    let id = 0;
    const step = (now: number) => {
      const p = Math.min((now - start) / 5500, 1);
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setSuccessLookY(-5 + 9 * eased);
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    const clear = window.setTimeout(() => setConfetti([]), 8000);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(clear);
    };
  }, [loginSuccess]);

  const purpleTransform = hasEntered
    ? peekingPwd
      ? 'skewX(0deg)'
      : isTyping || isHiding
        ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
        : `skewX(${purplePos.bodySkew || 0}deg)`
    : undefined;

  const blackTransform = hasEntered
    ? peekingPwd
      ? 'skewX(0deg)'
      : lookingEachOther
        ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
        : isTyping || isHiding
          ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
          : `skewX(${blackPos.bodySkew || 0}deg)`
    : undefined;

  return (
    <div className="atlas-chars">
      {confetti.length > 0 && (
        <div className="atlas-confetti">
          {confetti.map((c) => (
            <div key={c.key} className="atlas-confetti-piece" style={c.style} />
          ))}
        </div>
      )}

      {/* Purple */}
      <div
        ref={purpleRef}
        className={`atlas-char atlas-char-purple${hasEntered ? ' is-ready' : ''}`}
        style={{
          left: 70,
          width: 180,
          height: isTyping || isHiding ? 440 : 400,
          backgroundColor: '#6C3FF5',
          zIndex: 1,
          transform: purpleTransform,
        }}
      >
        <div
          className="atlas-char-eyes atlas-char-eyes--purple"
          style={{
            left: peekingPwd ? 50 : lookingEachOther ? 85 : 75 + purplePos.faceX,
            top: peekingPwd ? 20 : lookingEachOther ? 50 : 25 + purplePos.faceY,
          }}
        >
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            isBlinking={purpleBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? (purplePeek ? 5 : -5) : isHiding ? 6 : lookingEachOther ? 3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? (purplePeek ? 4 : -3) : isHiding ? -6 : lookingEachOther ? 4 : undefined}
          />
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            isBlinking={purpleBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? (purplePeek ? 5 : -5) : isHiding ? 6 : lookingEachOther ? 3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? (purplePeek ? 4 : -3) : isHiding ? -6 : lookingEachOther ? 4 : undefined}
          />
        </div>
        <div
          className={`atlas-mouth-purple${
            (isTyping || isHiding) && !loginFailed && !loginSuccess
              ? ' is-typing'
              : loginFailed
                ? ' is-sad'
                : loginSuccess
                  ? ' is-happy'
                  : ''
          }`}
          style={{
            left: peekingPwd ? 72 : lookingEachOther ? 106 : 97 + purplePos.faceX,
            top: peekingPwd ? 57 : lookingEachOther ? 82 : 57 + purplePos.faceY,
            ['--counter-skew' as string]:
              isTyping || isHiding
                ? `skewX(${-((purplePos.bodySkew || 0) - 12)}deg)`
                : 'skewX(0deg)',
          }}
        />
      </div>

      {/* Black */}
      <div
        ref={blackRef}
        className={`atlas-char atlas-char-black${hasEntered ? ' is-ready' : ''}`}
        style={{
          left: 240,
          width: 120,
          height: 310,
          backgroundColor: '#2D2D2D',
          zIndex: 2,
          transform: blackTransform,
        }}
      >
        <div
          className="atlas-char-eyes atlas-char-eyes--black"
          style={{
            left: peekingPwd ? 10 : lookingEachOther ? 32 : 26 + blackPos.faceX,
            top: peekingPwd ? 28 : lookingEachOther ? 12 : 32 + blackPos.faceY,
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={blackBlink}
            isSad={loginFailed}
            sadRotate={-20}
            forceLookX={loginSuccess ? 0 : peekingPwd ? 5 : isHiding ? -5 : lookingEachOther ? 0 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 3 : isHiding ? -6 : lookingEachOther ? -4 : undefined}
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={blackBlink}
            isSad={loginFailed}
            sadRotate={20}
            forceLookX={loginSuccess ? 0 : peekingPwd ? 5 : isHiding ? -5 : lookingEachOther ? 0 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 3 : isHiding ? -6 : lookingEachOther ? -4 : undefined}
          />
        </div>
      </div>

      {/* Orange */}
      <div
        ref={orangeRef}
        className={`atlas-char atlas-char-orange${hasEntered ? ' is-ready' : ''}`}
        style={{
          left: 0,
          width: 240,
          height: 150,
          backgroundColor: '#FF9B6B',
          borderRadius: '120px 120px 0 0',
          zIndex: 3,
          transform: hasEntered
            ? peekingPwd
              ? 'skewX(0deg)'
              : `skewX(${orangePos.bodySkew || 0}deg)`
            : undefined,
        }}
      >
        <div
          className="atlas-char-eyes atlas-char-eyes--orange"
          style={{
            left: peekingPwd ? 80 : 112 + orangePos.faceX,
            top: peekingPwd ? 55 : 60 + orangePos.faceY,
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={orangeBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? 5 : isHiding ? -4 : isTyping ? -3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 3 : isHiding ? -5 : isTyping ? -4 : undefined}
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={orangeBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? 5 : isHiding ? -4 : isTyping ? -3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 3 : isHiding ? -5 : isTyping ? -4 : undefined}
          />
        </div>
        <div
          className={`atlas-mouth-orange${
            (isTyping || isHiding) && !loginFailed && !loginSuccess
              ? ' is-typing'
              : loginFailed
                ? ' is-sad'
                : loginSuccess
                  ? ' is-happy'
                  : ''
          }`}
          style={{
            left: peekingPwd ? 94 : 126 + orangePos.faceX,
            top: peekingPwd ? 87 : 92 + orangePos.faceY,
          }}
        />
      </div>

      {/* Yellow */}
      <div
        ref={yellowRef}
        className={`atlas-char atlas-char-yellow${hasEntered ? ' is-ready' : ''}`}
        style={{
          left: 310,
          width: 140,
          height: 230,
          backgroundColor: '#E8D754',
          borderRadius: '70px 70px 0 0',
          zIndex: 4,
          transform: hasEntered
            ? peekingPwd
              ? 'skewX(0deg)'
              : `skewX(${yellowPos.bodySkew || 0}deg)`
            : undefined,
        }}
      >
        <div
          className="atlas-char-eyes atlas-char-eyes--yellow"
          style={{
            left: peekingPwd ? 20 : 52 + yellowPos.faceX,
            top: peekingPwd ? 35 : 40 + yellowPos.faceY,
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={yellowBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? -5 : isHiding ? 4 : isTyping ? -3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 2 : isHiding ? -5 : isTyping ? -4 : undefined}
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={yellowBlink}
            forceLookX={loginSuccess ? 0 : peekingPwd ? -5 : isHiding ? 4 : isTyping ? -3 : undefined}
            forceLookY={loginSuccess ? successLookY : peekingPwd ? 2 : isHiding ? -5 : isTyping ? -4 : undefined}
          />
        </div>
        <div
          className="atlas-mouth-yellow-wrap"
          style={{
            left: peekingPwd ? 10 : 40 + yellowPos.faceX,
            top: peekingPwd ? 88 : 88 + yellowPos.faceY,
          }}
        >
          <svg width="80" height="20" viewBox="0 0 80 20">
            <path
              className={`atlas-mouth-yellow-path${loginFailed ? ' is-wavy' : loginSuccess ? ' is-happy' : ''}`}
              stroke="#2D2D2D"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              d={
                loginFailed
                  ? 'M0 10 Q10 2, 20 10 Q30 18, 40 10 Q50 2, 60 10 Q70 18, 80 10'
                  : loginSuccess
                    ? 'M0 2 Q10 10, 20 14 Q30 18, 40 18 Q50 18, 60 14 Q70 10, 80 2'
                    : 'M0 10 Q10 10, 20 10 Q30 10, 40 10 Q50 10, 60 10 Q70 10, 80 10'
              }
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
