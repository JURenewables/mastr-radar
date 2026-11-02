import Link from "next/link";

import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate, formatPower } from "@/lib/format";

const SECTIONS: { href: string; scope: string; title: string; text: string; fact?: (k: Facts) => string }[] = [
  {
    href: "/monitor",
    scope: "Germany",
    title: "Energy transition",
    text: "The big picture: 37 years of build-out on a map, the 2030 targets, this year so far, batteries and co-location, states and the pipeline, and a day of generation in 15-minute steps.",
    fact: (k) => `${formatPower(k.total)} renewables in operation`,
  },
  {
    href: "/wind",
    scope: "Germany",
    title: "Wind & auctions",
    text: "Who wins the onshore wind auctions and at what price, rising and fading companies, where the projects go, the overheating market, and the turbines behind it.",
    fact: (k) => `${formatPower(k.wind)} onshore wind`,
  },
  {
    href: "/solar",
    scope: "Germany",
    title: "Solar & auctions",
    text: "Ground-mounted solar auctions: prices, winners, portfolios under the bid cap, batteries on site, yield, the biggest winner's insolvency, rooftops and balconies.",
    fact: (k) => `${formatPower(k.solar)} solar`,
  },
  {
    href: "/grid",
    scope: "Germany",
    title: "Grid",
    text: "Which grid operators connect the renewables, the four TSO areas, large consumers and the demand wave, what bottlenecks cost, and the new connection rules.",
  },
  {
    href: "/players",
    scope: "Worldwide",
    title: "Players",
    text: "Utilities, IPPs, investors and developers in the German market compared: staff, earnings, debt, capacity, markets abroad, generation mix, and who is moving forward or stuck.",
  },
  {
    href: "/explore",
    scope: "Tool",
    title: "Explore",
    text: "Filter all 9.6 million units by technology, status, size, region and commissioning date. Map, charts, table and CSV download.",
  },
  {
    href: "/open-data",
    scope: "Data",
    title: "Open data & AI",
    text: "Every file behind the site, with licence and schema. Point your AI agent at one address and it finds the answer.",
  },
  {
    href: "/methodology",
    scope: "Method",
    title: "Methodology",
    text: "Sources, definitions, models, known gaps and how each figure is checked.",
  },
];

interface Facts {
  total: number;
  wind: number;
  solar: number;
}

export default async function Home() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  const kw = (t: string) => (data.ok ? (data.kpis.find((k) => k.technology === t)?.installed_capacity_kw ?? 0) : 0);
  const facts: Facts = {
    total: data.ok ? data.kpis.filter((k) => k.technology !== "storage").reduce((s, k) => s + k.installed_capacity_kw, 0) : 0,
    wind: kw("wind_onshore"),
    solar: kw("solar"),
  };
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">MaStR Radar</p>
          <h1 className="mt-4 max-w-4xl text-[2.6rem] leading-[1.02] sm:text-7xl">
            Germany&rsquo;s renewables, auctions and grid, from the official register.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Free, updated every day, with sources and method on every chart. Built for energy
            companies, developers, investors and consultants. Pick where to start:
          </p>
        </section>

        <section className="grid gap-3 pb-12 sm:grid-cols-2">
          {SECTIONS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              className={`group flex flex-col rounded-[20px] p-6 transition-colors sm:p-7 ${i < 4 ? "bg-surface hover:bg-rule" : "border border-rule hover:bg-surface"}`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{s.scope}</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                {s.title} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>
              </p>
              <p className="mt-2 flex-1 text-ink-muted">{s.text}</p>
              {s.fact && data.ok && <p className="figures mt-4 text-sm font-semibold">{s.fact(facts)}</p>}
            </Link>
          ))}
        </section>

        <p className="pb-10 text-xs text-ink-muted">
          Source: Marktstammdatenregister{asOf ? `, as of ${asOf}` : ""}, plus Bundesnetzagentur auction
          results, SMARD, Deutscher Wetterdienst and the sources linked on each page. Gross capacity.
        </p>
      </main>
    </>
  );
}
