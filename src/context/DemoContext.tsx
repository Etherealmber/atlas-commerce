import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  enterDemoMode,
  exitDemoMode,
  isDemoMode,
  resetDemoData,
  getSandbox,
  type DemoSandbox,
} from '../lib/demoMode';

type DemoCtx = {
  active: boolean;
  sandbox: DemoSandbox | null;
  enter: () => void;
  exit: () => void;
  reset: () => void;
  refresh: () => void;
};

const Ctx = createContext<DemoCtx>({
  active: false,
  sandbox: null,
  enter: () => {},
  exit: () => {},
  reset: () => {},
  refresh: () => {},
});

export function DemoProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(() => isDemoMode());
  const [sandbox, setSandbox] = useState<DemoSandbox | null>(() => (isDemoMode() ? getSandbox() : null));

  const refresh = useCallback(() => {
    const on = isDemoMode();
    setActive(on);
    setSandbox(on ? getSandbox() : null);
  }, []);

  useEffect(() => {
    const onMode = () => refresh();
    const onData = () => {
      if (isDemoMode()) setSandbox(getSandbox());
    };
    window.addEventListener('atlas-demo-mode', onMode as EventListener);
    window.addEventListener('atlas-demo-data', onData as EventListener);
    return () => {
      window.removeEventListener('atlas-demo-mode', onMode as EventListener);
      window.removeEventListener('atlas-demo-data', onData as EventListener);
    };
  }, [refresh]);

  const value = useMemo<DemoCtx>(
    () => ({
      active,
      sandbox,
      enter: () => {
        enterDemoMode();
        refresh();
      },
      exit: () => {
        exitDemoMode();
        refresh();
        // Soft navigation to dashboard — live data loads via normal API
        try {
          window.dispatchEvent(new CustomEvent('atlas-demo-exited'));
        } catch {
          /* */
        }
      },
      reset: () => {
        resetDemoData();
        refresh();
      },
      refresh,
    }),
    [active, sandbox, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  return useContext(Ctx);
}
