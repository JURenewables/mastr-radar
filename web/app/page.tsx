import Link from "next/link";

import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { DEFAULT_FILTERS, filtersToParams, type Filters } from "@/lib/filters";
import { formatCount, formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { TECH_CSS_VAR, TECHNOLOGIES } from "@/lib/theme";
import type { Kpi } from "@/lib/types";

function exploreLink(patch: Partial<Filters>) {
  const qs = filtersToParams({ ...DEFAULT_FILTERS, ...patch }).toString();
  return qs ? `/explore?${qs}` : "/explore";
}

function TechCard({ kpi, year }: { kpi: Kpi; year: number }) {
  return (
    <Link
      href={exploreLink({ tech: [kpi.technology] })}
      className="group block border-t-2 pt-3 transition-colors hover:bg-ink/[0.03]"
      style={{ borderColor: `var(${TECH_CSS_VAR[kpi.technology]})` }}
    >
      <p className="text-sm text-ink-muted">{TECHNOLOGY_LABELS[kpi.technology]}</p>
      <p className="figures mt-1 font-serif text-3xl">{formatPower(kpi.installed_capacity_kw)}</p>
      <p className="figures mt-1 text-sm text-ink-muted">
        {formatCount(kpi.installed_units)} units ·{" "}
        <span className="text-ink">{formatPower(kpi.added_capacity_kw_ytd, { signed: true })}</span>{" "}
        in {year}
      </p>
      <p className="figures text-sm text-ink-muted">{formatPower(kpi.planned_capacity_kw)} planned</p>
    </Link>
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
  const month = manifest.as_of.slice(0, 7);
  const ordered = TECHNOLOGIES.map((t) => kpis.find((k) => k.technology === t)).filter(
    (k): k is Kpi => Boolean(k),
  );
  const total = kpis.reduce((s, k) => s + k.installed_capacity_kw, 0);
  const added = kpis.reduce((s, k) => s + k.added_capacity_kw_ytd, 0);

  const views: { title: string; text: string; href: string }[] = [
    {
      title: "Went online this month",
      text: "Every unit commissioned so far this month, on the map. Expect late registrations.",
      href: exploreLink({ status: [], from: month, to: month }),
    },
    {
      title: `Largest solar parks of ${year}`,
      text: "Solar units of 10 MW and more commissioned this year.",
      href: exploreLink({ tech: ["solar"], size: ["≥10 MW"], from: `${year}-01`, to: `${year}-12` }),
    },
    {
      title: "Onshore wind pipeline",
      text: "Turbines registered as planned: where the next build-out is coming.",
      href: exploreLink({ tech: ["wind_onshore"], status: ["planned"] }),
    },
    {
      title: `Large batteries built in ${year}`,
      text: "Storage units of 1 MW and more commissioned this year.",
      href: exploreLink({
        tech: ["storage"],
        size: ["1–10 MW", "≥10 MW"],
        from: `${year}-01`,
        to: `${year}-12`,
      }),
    },
    {
      title: "Offshore wind in the North Sea",
      text: "All turbines in the German North Sea, in operation.",
      href: exploreLink({ tech: ["wind_offshore"], state: "OFF_N" }),
    },
    {
      title: "Ageing wind fleet",
      text: "Onshore turbines in operation that went online before 2006: candidates for repowering.",
      href: exploreLink({ tech: ["wind_onshore"], to: "2005-12" }),
    },
  ];

  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:py-14">
        <section className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-wider text-accent">
            Germany · Marktstammdatenregister
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
            <span className="figures">{formatPower(total)}</span> of renewable capacity is in
            operation, <span className="figures">{formatPower(added)}</span> of it added in {year}
          </h1>
          <p className="mt-4 text-lg text-ink-muted">
            Explore every solar, wind, storage, biomass and hydro unit in the official register:
            where it is, how big, and when it went online. Updated daily.
          </p>
          <Link
            href="/explore"
            className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-paper hover:opacity-90"
          >
            Open the explorer
          </Link>
        </section>

        <section className="mt-14 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((kpi) => (
            <TechCard key={kpi.technology} kpi={kpi} year={year} />
          ))}
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-2xl">Ready-made views</h2>
          <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {views.map((v) => (
              <Link key={v.title} href={v.href} className="group block border-t border-rule pt-3">
                <h3 className="font-serif text-lg group-hover:underline">{v.title} →</h3>
                <p className="mt-1 text-sm text-ink-muted">{v.text}</p>
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-16 max-w-3xl space-y-2 text-sm text-ink-muted">
          <p>
            Gross capacity of units with status &ldquo;in operation&rdquo;. Recent months are
            incomplete: units are often registered weeks after they go online. Figures are
            cross-checked daily against Fraunhofer ISE Energy-Charts.
          </p>
          <p>Source: Marktstammdatenregister, as of {asOf}.</p>
        </div>
      </main>
    </>
  );
}
