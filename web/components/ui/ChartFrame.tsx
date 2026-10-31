import type { ReactNode } from "react";

/**
 * Every chart and map sits in a frame: a headline that states the finding,
 * an optional subtitle, the visual, and a source line (CLAUDE.md design rules).
 */
export function ChartFrame({
  title,
  subtitle,
  asOf,
  note,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  asOf: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="border-t border-ink pt-3">
      <figcaption>
        <h3 className="font-serif text-xl leading-snug">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </figcaption>
      <div className="mt-4">{children}</div>
      <p className="mt-3 text-xs text-ink-muted">
        {note && <>{note} </>}
        Source: Marktstammdatenregister, as of {asOf}.
      </p>
    </figure>
  );
}
