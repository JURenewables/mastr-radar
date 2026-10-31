"use client";

import type { ReactNode } from "react";

/** One monitor section: eyebrow, finding as headline, subtitle, content, source. */
export function Section({
  id,
  eyebrow,
  title,
  subtitle,
  note,
  asOf,
  source,
  children,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  note?: ReactNode;
  asOf: string;
  /** Replaces the default MaStR source line. */
  source?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-rule py-12 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 max-w-3xl text-3xl leading-[1.08] sm:text-[2.6rem]">{title}</h2>
      {subtitle && <p className="mt-3 max-w-2xl text-ink-muted">{subtitle}</p>}
      <div className="mt-7">{children}</div>
      <p className="mt-5 text-xs text-ink-muted">
        {note && <>{note} </>}
        {source ?? <>Source: Marktstammdatenregister, as of {asOf}.</>}
      </p>
    </section>
  );
}

/** Pill switch for 2–5 options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; swatch?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="scroll-row inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-rule bg-surface p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            value === o.value ? "bg-ink text-paper" : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.swatch && (
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: o.swatch }} />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Big-number tile. */
export function Stat({ label, value, sub, swatch }: { label: string; value: string; sub?: string; swatch?: string }) {
  return (
    <div className="rounded-[20px] bg-surface p-5">
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        {swatch && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: swatch }} />}
        {label}
      </p>
      <p className="figures mt-1 text-3xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="figures mt-1 text-sm text-ink-muted">{sub}</p>}
    </div>
  );
}

export function Loading({ height = 280 }: { height?: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-[20px] bg-surface text-sm text-ink-muted"
    >
      Loading…
    </div>
  );
}
