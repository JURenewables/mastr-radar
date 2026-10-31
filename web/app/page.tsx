import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatCount, formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import type { Kpi } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-rule pt-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="figures mt-1 text-2xl font-medium">{value}</dd>
    </div>
  );
}

function StatRow({ kpi, year }: { kpi: Kpi; year: number }) {
  return (
    <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      <Stat label="Units in operation" value={formatCount(kpi.installed_units)} />
      <Stat
        label={`Commissioned in ${year}`}
        value={formatPower(kpi.added_capacity_kw_ytd, { signed: true })}
      />
      <Stat label="Planned" value={formatPower(kpi.planned_capacity_kw)} />
    </dl>
  );
}

export default async function Home() {
  const data = await loadExplorerData();

  if (!data.ok) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-3xl px-5 py-12">
          <h1 className="font-serif text-3xl">Data temporarily unavailable</h1>
          <p className="mt-4 text-ink-muted">{data.reason}</p>
        </main>
      </>
    );
  }

  const { manifest, kpis } = data;
  const asOf = formatDate(manifest.as_of);
  const year = Number(manifest.as_of.slice(0, 4));
  const onshore = kpis.find((k) => k.technology === "wind_onshore");
  const others = kpis.filter((k) => k.technology !== "wind_onshore");
  const incomplete = manifest.incomplete_after.wind_onshore;

  return (
    <>
      <Header asOf={asOf} />
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
        {onshore && (
          <section>
            <p className="text-sm font-medium uppercase tracking-wider text-wind-onshore">
              Onshore wind · Germany
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
              <span className="figures">{formatPower(onshore.installed_capacity_kw)}</span> of
              onshore wind is in operation
            </h1>
            <div className="mt-8">
              <StatRow kpi={onshore} year={year} />
            </div>
          </section>
        )}

        {others.map((kpi) => (
          <section key={kpi.technology} className="mt-14">
            <h2 className="font-serif text-2xl">
              {TECHNOLOGY_LABELS[kpi.technology]}:{" "}
              <span className="figures">{formatPower(kpi.installed_capacity_kw)}</span> in
              operation
            </h2>
            <div className="mt-5">
              <StatRow kpi={kpi} year={year} />
            </div>
          </section>
        ))}

        <div className="mt-14 space-y-2 text-sm text-ink-muted">
          {incomplete && (
            <p>
              Commissioning data after {formatDate(incomplete)} may be incomplete: units are
              often registered weeks after they go online.
            </p>
          )}
          <p>
            Source: Marktstammdatenregister, as of {asOf}. Gross capacity of units with
            status &ldquo;in operation&rdquo;.
          </p>
        </div>
      </main>
    </>
  );
}
