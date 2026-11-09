import { useCallback, useState, type CSSProperties } from 'react';

// Z-order of the parts floating in .sim__body (SimWindow.tsx). Its own file: a file that
// exports hooks beside a component breaks Vite's fast refresh.

/** Z-order of everything floating in .sim__body: the last raised is on top. */
export function useWindowStack() {
  const [order, setOrder] = useState<string[]>([]);
  const raise = useCallback((key: string) => setOrder(o => (o[o.length - 1] === key ? o : [...o.filter(k => k !== key), key])), []);
  const z = useCallback((key: string) => {
    const i = order.indexOf(key);
    return 10 + (i < 0 ? 0 : i + 1);
  }, [order]);
  return { z, raise };
}
export type WindowStack = ReturnType<typeof useWindowStack>;

/** A docked part (overview panel, legend) joins the stack: a press brings it to the front; it never moves. */
export function stackProps(stack: WindowStack, key: string) {
  return { style: { zIndex: stack.z(key) } as CSSProperties, onPointerDownCapture: () => stack.raise(key) };
}
