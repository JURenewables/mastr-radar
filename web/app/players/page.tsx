import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { Players } from "@/components/players/Players";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Players worldwide · MaStR Radar",
  description:
    "The utilities, IPPs, investors and developers that compete in Germany's wind and solar auctions: staff, earnings, debt, capacity, markets abroad, generation mix and who is moving forward or stuck.",
};

export default async function PlayersPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Worldwide · Market participants</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Players worldwide</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            The companies that compete for Germany&rsquo;s wind and solar auctions, and what they are
            beyond them: how big, how indebted, where else they operate, what they burn or split, and
            who is moving forward or stuck.
          </p>
        </section>
        {data.ok ? <Players version={data.manifest.as_of} /> : <p className="pb-10 text-ink-muted">{data.reason}</p>}
      </main>
    </>
  );
}
