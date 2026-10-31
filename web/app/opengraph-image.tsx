import { ImageResponse } from "next/og";

import { loadExplorerData } from "@/lib/data";
import { formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { TECHNOLOGIES } from "@/lib/theme";

// Link preview card, built from the data at build time (refreshed with each daily deploy).
export const alt = "MaStR Radar: Germany's renewable capacity, explored";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f7f4ee";
const INK = "#1a1816";
const MUTED = "#5f5a53";
const ACCENT = "#b4441e";

export default async function Image() {
  const data = await loadExplorerData();
  const kpis = data.ok ? data.kpis : [];
  const total = kpis.reduce((s, k) => s + k.installed_capacity_kw, 0);
  const asOf = data.ok ? formatDate(data.manifest.as_of) : "";
  const rows = TECHNOLOGIES.map((t) => kpis.find((k) => k.technology === t)).filter(Boolean);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 28, color: ACCENT, letterSpacing: 2 }}>MASTR RADAR</div>
          <div style={{ fontSize: 76, marginTop: 24, lineHeight: 1.1 }}>
            {`${formatPower(total)} of renewables in operation in Germany`}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 40px", fontSize: 30, color: MUTED }}>
          {rows.map((k) => (
            <div key={k!.technology} style={{ display: "flex" }}>
              {`${TECHNOLOGY_LABELS[k!.technology]} ${formatPower(k!.installed_capacity_kw)}`}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 24, color: MUTED }}>
          {`Source: Marktstammdatenregister, © Bundesnetzagentur, as of ${asOf}`}
        </div>
      </div>
    ),
    { ...size },
  );
}
