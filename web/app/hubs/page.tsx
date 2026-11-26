import type { Metadata } from "next";

import { Hubs } from "@/components/hubs/Hubs";
import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Multi-asset hubs · MaStR Radar",
  description: "Where wind, solar, batteries, gas and hydrogen plants, electrolysers and large consumers come together in Germany, the power, gas and hydrogen networks around them, and a siting screen by district.",
};

export default async function HubsPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Germany · Hubs</p>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] leading-[1.04] sm:text-6xl">Multi-asset hubs</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Flexible energy sites that combine several parts: wind, solar, batteries, gas or hydrogen plants, electrolysers, gas storage and large
            consumers. Where they already exist, the networks around them, and where the next ones would fit.
          </p>
        </section>
        <Hubs version={data.ok ? data.manifest.as_of : "0"} />
      </main>
    </>
  );
}
