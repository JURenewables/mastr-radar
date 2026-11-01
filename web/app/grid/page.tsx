import type { Metadata } from "next";

import { Grid } from "@/components/grid/Grid";
import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Germany: grid · MaStR Radar",
  description:
    "Germany's power grid and the energy transition: which grid operators connect wind, solar and storage, the four TSO control areas, large consumers and the demand wave, redispatch costs and the new connection rules.",
};

export default async function GridPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Grid</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Germany&rsquo;s grid</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Who connects the wind and solar parks, where the power is made and where it is needed,
            what bottlenecks cost, and how the rules for getting on the grid are changing.
          </p>
        </section>
        {data.ok ? <Grid version={data.manifest.as_of} /> : <p className="pb-10 text-ink-muted">{data.reason}</p>}
      </main>
    </>
  );
}
