import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { Monitor } from "@/components/monitor/Monitor";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Germany: wind & auctions · MaStR Radar",
  description:
    "Germany's onshore wind industry: turbine makers and models, repowering, and every onshore wind auction since 2019 with prices, winners, a map of awarded projects and estimated site quality.",
};

export default async function WindPage() {
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
  const asOf = formatDate(data.manifest.as_of);
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Onshore wind</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Germany&rsquo;s wind &amp; auctions</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Who builds Germany&rsquo;s wind turbines, which models go up, and who wins the onshore
            wind auctions: prices, winners, where the awarded projects are, how windy their sites
            are, and why developers keep winning.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-ink-muted">
            Everything on this page covers Germany only. For the same companies worldwide (size,
            debt, markets abroad, generation mix), see{" "}
            <a href="/players" className="text-accent underline underline-offset-2">Players worldwide</a>.
          </p>
        </section>
        <Monitor asOf={data.manifest.as_of} part="wind" />
        <p className="pb-10 text-xs text-ink-muted">
          Sources: Marktstammdatenregister (as of {asOf}), Bundesnetzagentur award lists and round
          results, Deutscher Wetterdienst wind grid. See the methodology page for definitions and
          limits.
        </p>
      </main>
    </>
  );
}
