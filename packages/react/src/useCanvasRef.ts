import { useCallback, useState } from "react";

/**
 * A canvas element does not exist until React commits it to the DOM, and a plain `useRef` does
 * not re-render on attach — so effects that need the live element (`useGpuCanvas`,
 * `useGpuComponent`) would never re-run once it appears. This returns a callback ref that stores
 * the element in state instead, so dependent effects re-run exactly when the element attaches (and
 * again on detach/remount).
 */
export function useCanvasRef(): [
  HTMLCanvasElement | null,
  (el: HTMLCanvasElement | null) => void,
] {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const ref = useCallback((el: HTMLCanvasElement | null) => {
    setCanvas(el);
  }, []);
  return [canvas, ref];
}
