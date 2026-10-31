import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  filtersToParams,
  parseFilters,
  summaryWhere,
  unitsWhere,
  type Filters,
} from "./filters";

describe("filters", () => {
  it("defaults to units in operation", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
    expect(summaryWhere(DEFAULT_FILTERS)).toBe("WHERE status IN ('operating')");
  });

  it("round-trips through the URL", () => {
    const f: Filters = {
      tech: ["solar", "wind_onshore"],
      status: [],
      size: ["1–10 MW", "≥10 MW"],
      state: "09",
      from: "2026-01",
      to: "2026-03",
    };
    const params = filtersToParams(f);
    expect(params.toString()).toBe(
      "tech=solar%2Cwind_onshore&status=&size=l%2Cxl&state=09&from=2026-01&to=2026-03",
    );
    expect(parseFilters(params)).toEqual(f);
  });

  it("drops anything not on the allowed lists", () => {
    const f = parseFilters(
      new URLSearchParams("tech=solar,evil';DROP&status=planned,x&state=99'&from=2026-13&to=abc"),
    );
    expect(f.tech).toEqual(["solar"]);
    expect(f.status).toEqual(["planned"]);
    expect(f.state).toBeNull();
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });

  it("builds SQL for months on both files", () => {
    const f: Filters = { ...DEFAULT_FILTERS, status: [], from: "2026-03", to: "2026-03" };
    expect(summaryWhere(f)).toBe(
      "WHERE commissioning_month >= '2026-03' AND commissioning_month <= '2026-03'",
    );
    expect(unitsWhere(f)).toBe(
      "WHERE commissioning_date >= DATE '2026-03-01' AND commissioning_date < (DATE '2026-03-01' + INTERVAL 1 MONTH)",
    );
  });

  it("accepts offshore regions", () => {
    expect(parseFilters(new URLSearchParams("state=OFF_N")).state).toBe("OFF_N");
  });
});
