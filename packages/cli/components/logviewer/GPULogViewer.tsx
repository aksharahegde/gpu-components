import { normalizeWheel } from "@gpu-components/core";
import type { ViewportState } from "@gpu-components/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { LogViewerComponent, type LogSource } from "./LogViewerComponent.ts";
import type { LogQuery } from "./ingest.ts";
import { DEFAULT_LOG_THEME, drawLogText, type LogTextTheme } from "./textLayer.ts";

const DEFAULT_LINE_HEIGHT = 15;

export interface GPULogViewerProps {
  readonly source: LogSource;
  readonly viewport: ViewportState;
  readonly lineHeight?: number;
  readonly query?: LogQuery;
  readonly follow?: boolean;
  readonly onFollowChange?: (follow: boolean) => void;
  readonly selectedLine?: number | null;
  readonly onSelectLine?: (logical: number | null) => void;
  readonly theme?: LogTextTheme;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPULogViewer` — a log over a GPU-resident ring, with Canvas2D glyphs on top.
 *
 * Three things here differ from the other wrappers, each for a reason worth stating.
 *
 * **It owns a second canvas.** Rows, stripes, selection and the minimap are GPU work; the glyphs are
 * not, because `spikes/log-text-budget.md` measured the alternative and a glyph atlas never won. The
 * two surfaces are kept in lockstep by construction: both position a line with
 * `index * lineHeight - scrollPx`, using the same `scrollPx` remainder the shader receives.
 *
 * **Scroll is the interaction, not zoom.** Every other component here maps a domain to a viewport
 * and zooms it. A log has one natural scale — one line, one row — so this wrapper deliberately
 * offers no zoom, and `ViewportState` is used only for its pixel size.
 *
 * **Following is a mode, and it yields.** `tail -f` that fights the user is worse than no tailing,
 * so any upward scroll turns follow off, and the host is told through `onFollowChange` rather than
 * having the component silently disagree with its own prop.
 */
export function GPULogViewer(props: GPULogViewerProps): JSX.Element {
  const { source, viewport, query, onFollowChange, onSelectLine, style, className } = props;
  const { status } = useGpu();
  const lineHeight = props.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const theme = props.theme ?? DEFAULT_LOG_THEME;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [textCanvas, setTextCanvas] = useState<HTMLCanvasElement | null>(null);
  const [scrollTopPx, setScrollTopPx] = useState(0);

  const componentRef = useRef<LogViewerComponent | null>(null);
  const factory = useCallback(() => {
    const component = new LogViewerComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        source,
        viewport,
        lineHeight,
        query,
        follow: props.follow,
        scrollTopPx,
        selectedLine: props.selectedLine,
      }),
      [source, viewport, lineHeight, query, props.follow, scrollTopPx, props.selectedLine],
    ),
  );

  const lineCount = componentRef.current?.lineCount ?? 0;
  const focused = props.selectedLine ?? null;

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Log",
    summary:
      `${lineCount.toLocaleString("en-US")} lines.` +
      (query?.text ? ` Filtering for ${query.text}.` : "") +
      (props.follow ? " Following new output." : ""),
  });

  /**
   * Repaints the glyph layer.
   *
   * A layout effect rather than an effect: the GPU rows are painted by the scheduler's frame, and
   * running this after paint would let the text lag its own background by a frame during a fast
   * scroll — visible as the text sliding against the row stripes.
   */
  useLayoutEffect(() => {
    const el = textCanvas;
    const component = componentRef.current;
    if (!el || !component) return;

    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const width = viewport.width;
    const height = viewport.height;
    if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const offset = component.scrollOffsetPx;
    drawLogText({
      ctx,
      lines: component.visibleLines(),
      width,
      height,
      lineHeight,
      // The same decomposition the shader gets, so glyphs and rows cannot disagree.
      scrollPx: offset - Math.floor(offset / lineHeight) * lineHeight,
      dpr,
      queryText: query?.text ?? "",
      caseSensitive: query?.caseSensitive ?? false,
      filtering: Boolean(query?.text),
      theme,
    });
  });

  // Follow mode moves the scroll position without the user touching it; mirror it back so the
  // scrollbar and any host-side readout agree with what is on screen.
  useEffect(() => {
    const component = componentRef.current;
    if (!component || !props.follow) return;
    const offset = component.scrollOffsetPx;
    setScrollTopPx((current) => (Math.abs(current - offset) > 0.5 ? offset : current));
  }, [props.follow, source.version, viewport.height]);

  const maxScroll = Math.max(0, lineCount * lineHeight - viewport.height);
  const scrollBy = useCallback(
    (deltaPx: number) => {
      setScrollTopPx((current) => {
        const next = Math.min(Math.max(current + deltaPx, 0), maxScroll);
        // Scrolling up is an explicit request to stop tailing. Scrolling back to the bottom does not
        // silently re-enable it — re-arming a mode the user turned off is its own surprise.
        if (deltaPx < 0 && props.follow) onFollowChange?.(false);
        return next;
      });
    },
    [maxScroll, props.follow, onFollowChange],
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollBy(normalizeWheel(e).deltaY);
    };
    const onClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const hit = componentRef.current?.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      onSelectLine?.(hit ? Number(hit.id) : null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const page = Math.max(viewport.height - lineHeight, lineHeight);
      const moves: Record<string, number> = {
        ArrowDown: lineHeight,
        ArrowUp: -lineHeight,
        PageDown: page,
        PageUp: -page,
      };
      if (e.key in moves) {
        e.preventDefault();
        scrollBy(moves[e.key]!);
      } else if (e.key === "Home") {
        e.preventDefault();
        onFollowChange?.(false);
        setScrollTopPx(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setScrollTopPx(maxScroll);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("click", onClick);
    const root = el.parentElement;
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("click", onClick);
      root?.removeEventListener("keydown", onKeyDown);
    };
  }, [canvas, scrollBy, lineHeight, viewport.height, maxScroll, onSelectLine, onFollowChange]);

  // The focused line as real, selectable DOM text. §21.2 requires selectable label text, and canvas
  // glyphs are neither selectable nor copyable — this is the same answer GPUDataGrid.tsx gives.
  const focusedText = useMemo(() => {
    if (focused === null) return null;
    const component = componentRef.current;
    return component?.visibleLines().find((v) => v.logical === focused)?.text ?? null;
  }, [focused, source.version, scrollTopPx]);

  return (
    <div
      {...a11y.rootProps}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={setCanvas}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <canvas
        aria-hidden="true"
        ref={setTextCanvas}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // The glyph layer must never eat the wheel and click handlers on the GPU canvas below it.
          pointerEvents: "none",
        }}
      />
      {focusedText !== null && (
        <output
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            font: "12px ui-monospace, monospace",
            color: "#e7e9ee",
            background: "rgba(10,12,16,0.92)",
            padding: "4px 8px",
            userSelect: "text",
            whiteSpace: "pre-wrap",
          }}
        >
          {focusedText}
        </output>
      )}
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}
      {a11y.regions()}
    </div>
  );
}
