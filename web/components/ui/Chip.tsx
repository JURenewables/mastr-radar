"use client";

import type { ReactNode } from "react";

/** Toggle chip for filters. Shows state by border and fill, not colour alone. */
export function Chip({
  active,
  onClick,
  swatch,
  children,
}: {
  active: boolean;
  onClick: () => void;
  swatch?: string; // CSS colour for a small technology dot
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-rule text-ink-muted hover:border-ink-muted hover:text-ink"
      }`}
    >
      {swatch && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: swatch }}
        />
      )}
      {children}
    </button>
  );
}
