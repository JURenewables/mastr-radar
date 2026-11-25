import type { Metadata } from "next";
import Link from "next/link";

import { Costs } from "@/components/costs/Costs";
import { Profit } from "@/components/costs/Profit";
import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Onshore wind costs and profitability · MaStR Radar",
  description: "What an onshore wind farm in Germany costs to build and run: investment and operating costs by component, four sources compared (Deutsche WindGuard, Fraunhofer ISE, Danish Energy Agency, IRENA), trends and award prices.",
};

export default async function CostsPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Costs</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">What onshore wind costs and earns</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            CAPEX and OPEX benchmarks from the main public studies, and what awarded projects earn: estimated investment, revenue, return (IRR) and value, by round and region.
          </p>
          <nav className="mt-6 flex gap-2 text-sm font-semibold">
            <Link href="/costs/wind" className="rounded-full border border-rule px-4 py-1.5 hover:text-ink">Onshore wind</Link>
            <Link href="/costs/solar" className="rounded-full border border-rule px-4 py-1.5 hover:text-ink">Solar PV</Link>
          </nav>
        </section>
        <Costs tech="wind_onshore" version={data.ok ? data.manifest.as_of : "0"} extra={<Profit tech="wind" version={data.ok ? data.manifest.as_of : "0"} />} />
      </main>
    </>
  );
}
