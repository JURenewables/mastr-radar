"use client";

import { useEffect, useRef, useState } from "react";

/** Renders an Observable Plot figure; re-renders on resize and light/dark change. */
export function PlotFigure({
  render,
  deps,
  height = 280,
}: {
  render: (width: number) => SVGSVGElement | HTMLElement;
  deps: unknown[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scheme, setScheme] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setScheme((s) => s + 1);
    mq.addEventListener("change", onScheme);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || width === 0) return;
    const fig = render(width);
    el.replaceChildren(fig);
    return () => fig.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, scheme, ...deps]);

  return <div ref={ref} style={{ minHeight: height }} className="w-full text-ink" />;
}
