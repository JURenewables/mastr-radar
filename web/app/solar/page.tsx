import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { Monitor } from "@/components/monitor/Monitor";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Germany: solar & auctions · MaStR Radar",
  description:
    "Germany's ground-mounted solar: every solar and innovation auction since 2019 with prices, winners, portfolios, batteries on site, estimated yield and a map of awarded parks.",
};

export default async function SolarPage() {
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Solar</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Germany&rsquo;s solar &amp; auctions</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Ground-mounted solar is Germany&rsquo;s cheapest new power. Who wins the solar
            auctions, at what price, where the parks go, how big parks are split into capped bids,
            and how fast batteries join them.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-ink-muted">
            Everything on this page covers Germany only. For the same companies worldwide (size,
            debt, markets abroad, generation mix), see{" "}
            <a href="/players" className="text-accent underline underline-offset-2">Players worldwide</a>.
          </p>
        </section>
        <Monitor asOf={data.manifest.as_of} part="solar" />
        <p className="pb-10 text-xs text-ink-muted">
          Sources: Marktstammdatenregister (as of {asOf}), Bundesnetzagentur award lists and round
          results, Deutscher Wetterdienst radiation grid. See the methodology page for definitions and
          limits.
        </p>
      </main>
    </>
  );
}
