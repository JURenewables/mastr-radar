"use client";

import { Chip } from "@/components/ui/Chip";
import type { Filters } from "@/lib/filters";
import { TECHNOLOGY_LABELS } from "@/lib/format";
import { STATES } from "@/lib/regions";
import { SIZE_CLASSES, STATUS_LABELS, TECH_CSS_VAR, TECHNOLOGIES, type Status } from "@/lib/theme";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function FilterBar({
  filters,
  onChange,
  asOf,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  asOf: string; // YYYY-MM-DD
}) {
  const year = Number(asOf.slice(0, 4));
  const thisMonth = asOf.slice(0, 7);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const periodIs = (from: string | null, to: string | null) =>
    filters.from === from && filters.to === to;
  const presets: { label: string; from: string | null; to: string | null }[] = [
    { label: "Any time", from: null, to: null },
    { label: String(year), from: `${year}-01`, to: `${year}-12` },
    { label: String(year - 1), from: `${year - 1}-01`, to: `${year - 1}-12` },
    { label: "This month", from: thisMonth, to: thisMonth },
  ];

  return (
    <div className="space-y-5">
      <Group label="Technology">
        {TECHNOLOGIES.map((t) => (
          <Chip
            key={t}
            active={filters.tech.includes(t)}
            swatch={`var(${TECH_CSS_VAR[t]})`}
            onClick={() => set({ tech: toggle(filters.tech, t) })}
          >
            {TECHNOLOGY_LABELS[t]}
          </Chip>
        ))}
      </Group>

      <Group label="Status">
        {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
          <Chip
            key={s}
            active={filters.status.includes(s)}
            onClick={() => set({ status: toggle(filters.status, s) })}
          >
            {STATUS_LABELS[s]}
          </Chip>
        ))}
      </Group>

      <Group label="Size">
        {SIZE_CLASSES.map((s) => (
          <Chip
            key={s}
            active={filters.size.includes(s)}
            onClick={() => set({ size: toggle(filters.size, s) })}
          >
            {s}
          </Chip>
        ))}
      </Group>

      <Group label="Went online (commissioning date)">
        {presets.map((p) => (
          <Chip key={p.label} active={periodIs(p.from, p.to)} onClick={() => set(p)}>
            {p.label}
          </Chip>
        ))}
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          from
          <input
            type="month"
            value={filters.from ?? ""}
            max={thisMonth}
            onChange={(e) => set({ from: e.target.value || null })}
            className="rounded border border-rule bg-paper px-2 py-1 text-ink"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          to
          <input
            type="month"
            value={filters.to ?? ""}
            max={thisMonth}
            onChange={(e) => set({ to: e.target.value || null })}
            className="rounded border border-rule bg-paper px-2 py-1 text-ink"
          />
        </label>
      </Group>

      <Group label="Region">
        <select
          value={filters.state ?? ""}
          onChange={(e) => set({ state: e.target.value || null })}
          className="rounded border border-rule bg-paper px-2 py-1.5 text-sm"
          aria-label="Region"
        >
          <option value="">All of Germany</option>
          {STATES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </Group>
    </div>
  );
}
