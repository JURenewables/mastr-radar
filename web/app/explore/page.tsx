import type { Metadata } from "next";
import { Suspense } from "react";

import { Explorer } from "@/components/explorer/Explorer";
import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Explore · MaStR Radar",
  description:
    "Filter Germany's renewable energy register by technology, status, size, region and commissioning date. Map, charts, table and CSV download.",
};

export default async function ExplorePage() {
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
  const { manifest } = data;
  return (
    <>
      <Header asOf={formatDate(manifest.as_of)} wide />
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
        <h1 className="font-serif text-3xl sm:text-4xl">Explore the register</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Every renewable unit in Germany&rsquo;s Marktstammdatenregister. Pick filters; the
          map, charts and table follow, and the link always reproduces this view.
        </p>
        <div className="mt-8">
          {/* Filters live in the URL, which is only known in the browser. */}
          <Suspense fallback={<p className="text-ink-muted">Loading explorer…</p>}>
            <Explorer asOf={manifest.as_of} incompleteAfter={manifest.incomplete_after} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
