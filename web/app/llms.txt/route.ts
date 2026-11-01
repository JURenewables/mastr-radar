import { QUESTIONS, SOURCES } from "@/lib/aiGuide";
import { buildCatalog } from "@/lib/catalog";

export const dynamic = "force-static";

// Plain-text guide for AI agents (llms.txt convention).
export async function GET() {
  const c = await buildCatalog();
  const lines = [
    "# MaStR Radar",
    "",
    `> ${c.description}`,
    "",
    `Data as of ${c.as_of}. Updated daily. Contract (schemas, rules): ${c.contract_url} (version ${c.contract}).`,
    `Machine-readable catalogue: ${c.site}/catalog.json`,
    "All files are static and can be fetched directly (CORS enabled). Parquet files support HTTP range requests.",
    "",
    "## Datasets",
    "",
    ...c.datasets.map(
      (d) =>
        `- [${d.title}](${d.url}): ${d.description} Format: ${d.format}.${d.rows != null ? ` Rows: ${d.rows}.` : ""} Licence: ${d.licence.id}. Attribution: ${d.attribution}.`,
    ),
    `- Day files: ${c.day_files.url_template} for ${c.day_files.first} to ${c.day_files.last} (${c.day_files.count} days): quarter-hourly generation per technology and demand (MW) for Germany and the 4 grid areas (SMARD), hourly radiation and wind per DWD station. Licence: CC-BY-4.0. Attribution: Bundesnetzagentur | SMARD.de; Deutscher Wetterdienst.`,
    "",
    "## Which file answers which question",
    "",
    ...QUESTIONS.map((q) => `- ${q.q} → ${q.files.join(", ")}. ${q.how}`),
    "",
    "## Pages (human-readable, same data)",
    "",
    `- ${c.site}/ energy-transition monitor · ${c.site}/wind and ${c.site}/solar Germany's auctions · ${c.site}/grid Germany's grid · ${c.site}/players companies worldwide · ${c.site}/explore filter and download · ${c.site}/methodology definitions and limits`,
    "",
    "## Primary sources (to go deeper yourself)",
    "",
    ...SOURCES.map((s) => `- ${s.name}: ${s.what}. Access: ${s.access} Licence: ${s.licence}.${s.key ? " Needs your own API credentials." : ""}`),
    "",
    "## Notes",
    "",
    "- Capacity is gross capacity (Bruttoleistung) in kW unless a field name says MW.",
    "- Units of private individuals have no name, operator or coordinates.",
    "- Recent months are incomplete because units are registered late; manifest.json gives a per-technology date.",
    "- Wholesale electricity prices are deliberately not included.",
    "",
    "## Examples",
    "",
    "```python",
    c.how_to.python,
    "```",
    "",
    "```sql",
    c.how_to.duckdb,
    "```",
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
