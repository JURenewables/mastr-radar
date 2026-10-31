import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate, TECHNOLOGY_LABELS } from "@/lib/format";
import { TECHNOLOGIES } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Methodology · MaStR Radar",
  description:
    "Where the data comes from, how it is processed and checked, definitions, privacy rules and known limitations.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className="underline decoration-rule underline-offset-2 hover:text-ink">
    {children}
  </a>
);

export default async function Methodology() {
  const data = await loadExplorerData();
  const manifest = data.ok ? data.manifest : null;

  return (
    <>
      <Header asOf={manifest ? formatDate(manifest.as_of) : undefined} />
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
        <h1 className="font-serif text-4xl">Methodology</h1>
        <p className="mt-4 text-lg text-ink-muted">
          How MaStR Radar turns the official register into the numbers, maps and charts on this
          site, and what to keep in mind when reading them.
        </p>

        <Section title="Source and licence">
          <p>
            All unit data comes from the Bundesnetzagentur&rsquo;s{" "}
            <A href="https://www.marktstammdatenregister.de/MaStR/Datendownload">
              Marktstammdatenregister (MaStR)
            </A>
            , the official register of all electricity generation and storage units in Germany.
            We use its daily bulk export (&ldquo;Gesamtdatenexport&rdquo;).
          </p>
          <p>
            Data © Bundesnetzagentur, licensed under the{" "}
            <A href="https://www.govdata.de/dl-de/by-2-0">
              Datenlizenz Deutschland – Namensnennung – Version 2.0
            </A>{" "}
            (DL-DE-BY-2.0). The data has been processed by MaStR Radar as described on this page.
            State and district boundaries: © GeoBasis-DE / BKG (2026), dl-de/by-2-0. Basemap:
            OpenFreeMap, © OpenMapTiles, data from OpenStreetMap.
          </p>
        </Section>

        <Section title="How the data is processed">
          <p>Every morning an automated job runs four steps, each with its own check:</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              <strong>Download</strong> the export (about 3.3 GB) and verify that it is complete,
              recent and undamaged.
            </li>
            <li>
              <strong>Extract</strong> solar, wind, storage, biomass and hydro units into one clean
              table: about 9.6 million units. Codes are translated, privacy rules applied and
              implausible values removed (see below).
            </li>
            <li>
              <strong>Summarise</strong> into the files this site reads: individual units from
              100 kW, and totals for every unit by technology, status, size, district and month.
            </li>
            <li>
              <strong>Publish</strong>: if every check passes, the site updates. If any check
              fails, the site keeps showing the last good data.
            </li>
          </ol>
          <p>
            Installed capacity is cross-checked daily against{" "}
            <A href="https://www.energy-charts.info">Fraunhofer ISE Energy-Charts</A>, which also
            builds on MaStR. Differences are usually well below 1%.
          </p>
        </Section>

        <Section title="Definitions">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Capacity</strong> is gross capacity (Bruttoleistung), as in the
              Bundesnetzagentur&rsquo;s own statistics. For solar this is module (DC) power.
            </li>
            <li>
              <strong>In operation</strong> counts units with that status only. Planned,
              temporarily shut down and permanently shut down units can be selected separately.
            </li>
            <li>
              <strong>Went online</strong> is the commissioning date (Inbetriebnahmedatum).
              Planned units have no commissioning date and drop out when a period is selected.
            </li>
            <li>
              <strong>Added this year</strong> counts units commissioned since 1 January,
              regardless of their current status. It is a gross figure: decommissioned units are
              not subtracted.
            </li>
            <li>
              <strong>Storage</strong> covers batteries, pumped hydro and other storage types.
              Storage capacity in kWh is usable capacity, recorded per storage plant and split
              evenly over the plant&rsquo;s units.
            </li>
            <li>
              <strong>Offshore wind</strong> is shown in two regions, North Sea and Baltic Sea,
              using the register&rsquo;s own sea field. It belongs to no district.
            </li>
            <li>
              <strong>Size classes</strong>: under 10 kW, 10–100 kW, 100 kW–1 MW, 1–10 MW and
              10 MW or more.
            </li>
          </ul>
        </Section>

        <Section title="Late registrations">
          <p>
            Units are often registered weeks or months after they go online, so the most recent
            months are always incomplete. For each technology we measure how long it takes until
            90% of units are registered. Charts shade the period after that date.
          </p>
          {manifest && (
            <table className="figures mt-2 w-full max-w-md text-sm">
              <thead className="border-b border-rule text-left text-ink-muted">
                <tr>
                  <th className="py-1 font-medium">Technology</th>
                  <th className="py-1 font-medium">Possibly incomplete after</th>
                </tr>
              </thead>
              <tbody>
                {TECHNOLOGIES.filter((t) => manifest.incomplete_after[t]).map((t) => (
                  <tr key={t} className="border-b border-rule/60">
                    <td className="py-1">{TECHNOLOGY_LABELS[t]}</td>
                    <td className="py-1">{formatDate(manifest.incomplete_after[t]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Privacy">
          <p>
            Many small units belong to private individuals. For these, the site never shows a
            unit name, operator name or exact location; they appear only in district totals.
            Units whose operator is unknown are treated the same way. Operator names are shown
            for companies, and only for units of 1 MW or more.
          </p>
          <p>
            Individual units appear on the map and in tables from 100 kW. Smaller units count in
            all totals, charts and the district map.
          </p>
        </Section>

        <Section title="Data quality rules">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Storage capacity above 24 hours per kW of power (100 hours for pumped hydro) is a
              registration error and is left empty.
            </li>
            <li>
              Impossible commissioning dates are left empty: solar before 1983, batteries before
              2000, and any date after the export date.
            </li>
            <li>Coordinates outside Germany and its sea area are left empty.</li>
            <li>
              Some hydro and solar units carry the placeholder date 1 January 1900; they are kept,
              but charts start in 2000.
            </li>
          </ul>
          <p>Every rule is counted in a daily report, so changes in the data stay visible.</p>
        </Section>

        <Section title="Known limitations">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              The register is only as good as its entries: operators register and update their
              own units, and corrections can appear later.
            </li>
            <li>
              About a quarter of solar units of 100 kW or more belong to private individuals and
              therefore have no position on the map.
            </li>
            <li>
              District boundaries are generalised (scale 1:2.5 million); they are meant for
              overview maps, not for parcel-level analysis.
            </li>
          </ul>
        </Section>

        <Section title="Open source">
          <p>
            Code, data contracts and full documentation:{" "}
            <A href="https://github.com/JURenewables/mastr-radar">
              github.com/JURenewables/mastr-radar
            </A>
            .
          </p>
        </Section>
      </main>
    </>
  );
}
