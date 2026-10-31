import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";

export const metadata: Metadata = { title: "Methodology · MaStR Radar" };

// Short version for now; the full methodology page comes in WP22.
export default function Methodology() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
        <h1 className="font-serif text-4xl">Methodology</h1>
        <div className="mt-6 space-y-4 leading-relaxed">
          <p>
            MaStR Radar is built from the daily bulk export of the Bundesnetzagentur&rsquo;s
            Marktstammdatenregister (MaStR). The export is downloaded, checked, and turned into
            a clean table of units, from which the figures on this site are calculated.
          </p>
          <p>
            Capacity is <strong>gross capacity</strong> (Bruttoleistung). &ldquo;In
            operation&rdquo; counts units with that status only. Units of private individuals
            are shown only as regional totals, never by name or exact location.
          </p>
          <p>
            Units are often registered weeks after they go online, so the most recent months
            are incomplete. Figures are cross-checked against Fraunhofer ISE Energy-Charts.
          </p>
          <p className="text-ink-muted">
            Data: © Bundesnetzagentur, licensed under the{" "}
            <a
              href="https://www.govdata.de/dl-de/by-2-0"
              className="underline decoration-rule underline-offset-2"
            >
              Datenlizenz Deutschland – Namensnennung – Version 2.0
            </a>
            . The data was processed by MaStR Radar. Source code and full documentation:{" "}
            <a
              href="https://github.com/JURenewables/mastr-radar"
              className="underline decoration-rule underline-offset-2"
            >
              github.com/JURenewables/mastr-radar
            </a>
            .
          </p>
        </div>
      </main>
    </>
  );
}
