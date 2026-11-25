import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { Outlook } from "@/components/outlook/Outlook";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Germany: outlook · MaStR Radar",
  description: "Looking ahead: repowering potential of Germany's ageing wind fleet on a map, and what the next wind and solar auction rounds are likely to bring.",
};

export default async function OutlookPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Outlook</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Looking ahead</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            The other pages look back. This one looks forward: which wind sites are due for
            repowering, and what the next auction rounds are likely to bring.
          </p>
        </section>
        {data.ok ? <Outlook version={data.manifest.as_of} /> : <p className="pb-10 text-ink-muted">{data.reason}</p>}
      </main>
    </>
  );
}
