import { createContext, useContext, type ReactNode } from 'react';

type DemoCtx = {
  active: boolean;
  sandbox: null;
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

/** Demo mode removed — provider is a no-op passthrough. */
export function DemoProvider({ children }: { children: ReactNode }) {
  return (
    <Ctx.Provider
      value={{
        active: false,
        sandbox: null,
        enter: () => {},
        exit: () => {},
        reset: () => {},
        refresh: () => {},
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDemo() {
  return useContext(Ctx);
}
