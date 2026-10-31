// State keys (first two digits of the official municipality code, AGS) and the
// two offshore regions (contract D8). Names as in the register (D7).
export const STATES: { key: string; name: string }[] = [
  { key: "01", name: "Schleswig-Holstein" },
  { key: "02", name: "Hamburg" },
  { key: "03", name: "Niedersachsen" },
  { key: "04", name: "Bremen" },
  { key: "05", name: "Nordrhein-Westfalen" },
  { key: "06", name: "Hessen" },
  { key: "07", name: "Rheinland-Pfalz" },
  { key: "08", name: "Baden-Württemberg" },
  { key: "09", name: "Bayern" },
  { key: "10", name: "Saarland" },
  { key: "11", name: "Berlin" },
  { key: "12", name: "Brandenburg" },
  { key: "13", name: "Mecklenburg-Vorpommern" },
  { key: "14", name: "Sachsen" },
  { key: "15", name: "Sachsen-Anhalt" },
  { key: "16", name: "Thüringen" },
  { key: "OFF_N", name: "Nordsee (offshore)" },
  { key: "OFF_O", name: "Ostsee (offshore)" },
];

export const STATE_NAME: Record<string, string> = Object.fromEntries(
  STATES.map((s) => [s.key, s.name]),
);
