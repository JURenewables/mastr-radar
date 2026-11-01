import Link from "next/link";

import { Header } from "@/components/layout/Header";
import { Monitor } from "@/components/monitor/Monitor";
import { Stat } from "@/components/monitor/ui";
import { loadExplorerData } from "@/lib/data";
import { DEFAULT_FILTERS, filtersToParams, type Filters } from "@/lib/filters";
import { formatCount, formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { TECH_CSS_VAR, TECHNOLOGIES } from "@/lib/theme";
import type { Kpi } from "@/lib/types";

function exploreLink(patch: Partial<Filters>) {
  const qs = filtersToParams({ ...DEFAULT_FILTERS, ...patch }).toString();
  return qs ? `/explore?${qs}` : "/explore";
}

export default async function Home() {
  const data = await loadExplorerData();
  if (!data.ok) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-3xl px-5 py-12">
          <h1 className="text-3xl">Data temporarily unavailable</h1>
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

  const views = [
    { title: "Went online this month", href: exploreLink({ status: [], from: month, to: month }) },
    { title: `Largest solar parks of ${year}`, href: exploreLink({ tech: ["solar"], size: ["≥10 MW"], from: `${year}-01`, to: `${year}-12` }) },
    { title: "Onshore wind pipeline", href: exploreLink({ tech: ["wind_onshore"], status: ["planned"] }) },
    { title: `Large batteries built in ${year}`, href: exploreLink({ tech: ["storage"], size: ["1–10 MW", "≥10 MW"], from: `${year}-01`, to: `${year}-12` }) },
    { title: "Offshore wind in the North Sea", href: exploreLink({ tech: ["wind_offshore"], state: "OFF_N" }) },
    { title: "Ageing wind fleet", href: exploreLink({ tech: ["wind_onshore"], to: "2005-12" }) },
  ];

  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Germany · Renewable energy monitor
          </p>
          <h1 className="mt-4 max-w-4xl text-[2.6rem] leading-[1.02] sm:text-7xl">
            <span className="figures">{formatPower(total)}</span> of renewables in operation.{" "}
            <span className="text-ink-muted">
              <span className="figures">{formatPower(added, { signed: true })}</span> in {year}.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Every solar, wind, storage, biomass and hydro unit in Germany&rsquo;s official register,
            updated daily. Scroll down to explore, play and compare.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {ordered.map((k) => (
              <Stat
                key={k.technology}
                label={TECHNOLOGY_LABELS[k.technology]}
                swatch={`var(${TECH_CSS_VAR[k.technology]})`}
                value={formatPower(k.installed_capacity_kw)}
                sub={`${formatPower(k.added_capacity_kw_ytd, { signed: true })} in ${year} · ${formatCount(k.installed_units)} units`}
              />
            ))}
          </div>
        </section>

        <Monitor asOf={manifest.as_of} />

        <Link
          href="/solar"
          className="mb-4 block rounded-[20px] bg-surface p-6 transition-colors hover:bg-rule sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Solar</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Solar parks, batteries and every solar auction since 2019 →
          </p>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Prices, where the parks go, who wins, how big parks are split into capped bids, and how
            fast solar parks get their own battery.
          </p>
        </Link>
        <Link
          href="/wind"
          className="mb-4 block rounded-[20px] bg-surface p-6 transition-colors hover:bg-rule sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Wind &amp; auctions</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Turbine makers, models and every onshore wind auction since 2019 →
          </p>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Who builds the turbines, who wins the auctions, at what price, on which sites, and why
            developers keep beating utilities.
          </p>
        </Link>

        <section className="border-t border-rule py-12 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Explore</p>
          <h2 className="mt-3 text-3xl sm:text-[2.6rem]">Dig into every unit</h2>
          <p className="mt-3 max-w-2xl text-ink-muted">
            The explorer filters all 9.6 million units by technology, status, size, region and
            commissioning date, with maps, charts, a table and CSV downloads.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {views.map((v) => (
              <Link
                key={v.title}
                href={v.href}
                className="rounded-[20px] bg-surface p-5 font-semibold transition-colors hover:bg-rule"
              >
                {v.title} →
              </Link>
            ))}
          </div>
          <Link
            href="/explore"
            className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 font-bold text-white"
          >
            Open the explorer
          </Link>
        </section>

        <p className="pb-10 text-xs text-ink-muted">
          Gross capacity. Recent months are incomplete because units are often registered weeks
          after going online. Cross-checked daily against Fraunhofer ISE Energy-Charts. Source:
          Marktstammdatenregister, as of {asOf}.
        </p>
      </main>
    </>
  );
}
