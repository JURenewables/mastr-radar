"use client";

// The Wind & auctions page as one storyline: the machines, the price, where
// the wind farms go, who wins, and why. Every section ends with takeaways and
// caveats computed from the data.
import type { ReactNode } from "react";

import { mw, type AuctionCategory, type CompanyProfile, type MonitorData } from "@/lib/monitor";

import { AuctionCake, AuctionCrossCheck, AuctionPlayers, AuctionPrices, AuctionRace, AuctionWinners, AuctionYield, makerShares, roundLabel, TurbinePartners } from "./Auctions";
import { AuctionMovie, CompanyMap } from "./AuctionMap";
import { Repowering, TurbineGrowth } from "./Sections";
import { Chapter, Loading, Section, Stat } from "./ui";
import { CrossTech, crossTakeaways, SuccessSection } from "./Strategy";
import { BrandRace, BrandShares, TurbineModels } from "./WindIndustry";

export const WIND_SECTIONS = [
  ["machines", "1 Machines"],
  ["price", "2 Price"],
  ["where", "3 Where"],
  ["who", "4 Who wins"],
  ["why", "5 Why"],
] as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export function WindStory({ data, asOf, date }: { data: MonitorData | null; asOf: string; date: string }) {
  if (!data) return <Loading height={600} />;
  const s = data.stats;
  const y = Number(asOf.slice(0, 4));
  const au = data.auctions;

  // --- Chapter 1 figures
  const t = s.onshore_turbines;
  const tLast = t.years.length - 2;
  const i2000 = t.years.indexOf(2000);
  const wi = s.wind_industry;
  const wiLast = wi.years.length - 2;
  const named = wi.brands.filter((b) => b !== "Other");
  const fleet = sum(wi.brands.map((b) => wi.installed_mw[b].at(-1)!));
  const addedLast = sum(wi.brands.map((b) => wi.added_mw[b][wiLast]));
  const byAdded = [...named].sort((a, b) => wi.added_mw[b][wiLast] - wi.added_mw[a][wiLast]);
  const top3Share = sum(byAdded.slice(0, 3).map((b) => wi.added_mw[b][wiLast])) / (addedLast || 1);
  const topModel = wi.recent_models[0];

  const source = au ? <>Source: Bundesnetzagentur, onshore wind auctions, linked to the Marktstammdatenregister as of {date}. Data processed.</> : undefined;

  return (
    <>
      <Chapter id="machines" n={1} title="The machines">
        Germany runs {mw(fleet)} of onshore wind. Three makers build almost all of it, and every
        new turbine is a giant compared with the ones it replaces.
      </Chapter>

      <Section
        id="turbines"
        eyebrow="Turbine size"
        title={i2000 >= 0 ? `A new wind turbine is ${(t.avg_mw[tLast] / t.avg_mw[i2000]).toFixed(1)}× as powerful as in 2000` : "Turbines keep growing"}
        subtitle="Average capacity, hub height and rotor diameter of the onshore turbines that went online each year. Drawn to scale."
        asOf={date}
        takeaways={[
          `Average new turbine in ${t.years[tLast]}: ${t.avg_mw[tLast].toFixed(1)} MW, ${Math.round(t.avg_hub_height_m[tLast] ?? 0)} m hub height, ${Math.round(t.avg_rotor_diameter_m[tLast] ?? 0)} m rotor.`,
          i2000 >= 0 ? `Rotor diameter grew from ${Math.round(t.avg_rotor_diameter_m[i2000] ?? 0)} m (2000) to ${Math.round(t.avg_rotor_diameter_m[tLast] ?? 0)} m: so the swept area, and with it the yield at low wind, grew about ${(((t.avg_rotor_diameter_m[tLast] ?? 1) / (t.avg_rotor_diameter_m[i2000] ?? 1)) ** 2).toFixed(0)}-fold.` : "",
        ].filter(Boolean)}
        caveats={[`${y} is still incomplete because turbines are registered with a delay.`]}
      >
        <TurbineGrowth data={data} />
      </Section>

      <Section
        id="makers"
        eyebrow="Turbine makers"
        title={`${named[0]} built ${pct(wi.installed_mw[named[0]].at(-1)! / fleet)} of Germany's onshore fleet; in ${wi.years[wiLast]} ${byAdded[0]} installed the most`}
        subtitle="Press play: the race between turbine makers since 1995, by capacity in operation or by capacity added each year."
        note={`The ${y} figures are still incomplete.`}
        asOf={date}
        takeaways={[
          `In ${wi.years[wiLast]}, ${byAdded.slice(0, 3).join(", ")} built ${pct(top3Share)} of all new onshore capacity: a three-player market.`,
          `${byAdded[0]} led ${wi.years[wiLast]} with ${mw(wi.added_mw[byAdded[0]][wiLast])}; ${named[0]} still runs the largest fleet with ${mw(wi.installed_mw[named[0]].at(-1)!)}.`,
          `Historic brands (Tacke, NEG Micon, Enron Wind, Bonus…) keep their own bars, so the race shows who actually built the turbines at the time.`,
        ]}
        caveats={[`Maker names as registered by operators, grouped into brands; ${pct(wi.unattributed_share)} of capacity has no clear maker.`]}
      >
        <div className="space-y-10">
          <BrandRace data={data} />
          <BrandShares data={data} />
        </div>
      </Section>

      <Section
        id="models"
        eyebrow="Turbine models"
        title={topModel ? `The ${topModel.brand} ${topModel.model} is the most-built turbine since ${wi.recent_models_since}: ${topModel.units} units, ${topModel.avg_hub_height_m} m hub height` : "Which turbines go up"}
        subtitle="The models that went online most often in recent years, and how rotors, towers and ratings have grown at each maker."
        asOf={date}
        takeaways={wi.recent_models.slice(0, 3).map((m) => `${m.brand} ${m.model}: ${m.units} turbines, ${m.avg_mw.toFixed(1)} MW each, ${m.avg_rotor_diameter_m ?? "–"} m rotor.`)}
        caveats={["Models are grouped by rotor size (all V162 variants count as V162)."]}
      >
        <TurbineModels data={data} />
      </Section>

      <Section
        id="repowering"
        eyebrow="Repowering"
        title={`${s.repowering.units.toLocaleString("en-GB")} wind turbines are older than ${s.repowering.age_years} years`}
        subtitle="Onshore turbines still in operation that went online at least 20 years ago, when EEG support typically ends."
        asOf={date}
        takeaways={[
          `These ${mw(s.repowering.mw)} average ${s.repowering.avg_mw_old ?? "–"} MW per turbine; a new one averages ${s.repowering.avg_mw_new ?? "–"} MW, so each replacement multiplies the capacity on the same site.`,
        ]}
        caveats={["Age by commissioning date; some older turbines have already been upgraded."]}
      >
        <Repowering data={data} />
      </Section>

      {au && <AuctionChapters data={data} date={date} source={source} />}
    </>
  );
}

function AuctionChapters({ data, date, source }: { data: MonitorData; date: string; source: ReactNode }) {
  const au = data.auctions!;
  const rounds = au.rounds;
  const first = rounds[0];
  const last = rounds.at(-1)!;
  const peak = rounds.reduce((m, r) => (r.avg_ct > m.avg_ct ? r : m), rounds[0]);
  const years = au.race.years;
  const yi = years.length - 1; // running year (incomplete)
  const yFull = years.length - 2; // last full year
  const kwYear = (i: number) => sum(Object.values(au.kw_by_category_year).map((v) => v[i]));
  const known = (i: number) => sum((["developer", "utility", "municipal", "citizen"] as AuctionCategory[]).map((c) => au.kw_by_category_year[c][i]));
  const devKnown = (i: number) => au.kw_by_category_year.developer[i] / (known(i) || 1);
  const catAll = (c: AuctionCategory) => sum(au.kw_by_category_year[c]) / sum(years.map((_, i) => kwYear(i)));

  // Where: state shares, first year vs last full year
  const stateShare = (i: number) => {
    const tot = sum(Object.values(au.kw_by_state_year).map((v) => v[i])) || 1;
    return Object.fromEntries(Object.entries(au.kw_by_state_year).map(([st, v]) => [st, v[i] / tot]));
  };
  const s0 = stateShare(0);
  const sF = stateShare(yFull);
  const topStates = Object.entries(sF).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const gains = Object.keys(sF).map((st) => [st, sF[st] - (s0[st] ?? 0)] as const).sort((a, b) => b[1] - a[1]);
  const south = (sh: Record<string, number>) => (sh["Baden-Württemberg"] ?? 0) + (sh["Bayern"] ?? 0);

  // Yield
  const w = rounds.filter((r) => r.full_load_hours_avg);
  const wavg = (k: "full_load_hours_avg" | "quality_pct_avg" | "correction_factor_avg") => sum(w.map((r) => (r[k] ?? 0) * r.list_kw)) / sum(w.map((r) => r.list_kw));
  const mktQuality = wavg("quality_pct_avg");

  // Winners
  const lastYear = years[yi];
  const namedWinners = (yr: string) => au.winners_by_year[yr].filter((x) => !x.bucket);
  const topNow = namedWinners(lastYear).slice(0, 3);
  const totalKw = sum(au.race.years.map((_, i) => kwYear(i)));
  const att = au.attribution_kw;
  const attT = sum(Object.values(att)) || 1;

  // Partners
  const partner = au.company_profiles.slice(0, 18).map((p) => {
    const sh = makerShares(p);
    const top = Object.entries(sh).sort((a, b) => b[1] - a[1])[0];
    return { g: p.group, m: top[0], s: top[1] };
  });
  const houses = partner.filter((p) => p.s >= 0.7 && p.m !== "Other");
  const multi = partner.filter((p) => p.s < 0.5);

  const companyTakeaways = (p: CompanyProfile) => {
    const total = sum(p.kw_by_year);
    const bestI = p.kw_by_year.indexOf(Math.max(...p.kw_by_year));
    const rankNow = namedWinners(lastYear).findIndex((x) => x.group === p.group);
    const states = Object.entries(p.kw_by_state);
    const sh = makerShares(p);
    const [maker, mShare] = Object.entries(sh).sort((a, b) => b[1] - a[1])[0];
    const office = p.attribution_kw.office / (total || 1);
    const reported = au.company_reported.filter((r) => r.group === p.group);
    const points: ReactNode[] = [
      `${p.group} won ${mw(total / 1000)} in ${p.awards} awards since ${p.first_bid.slice(0, 4)}; its best year was ${years[bestI]} with ${mw(p.kw_by_year[bestI] / 1000)}${rankNow >= 0 ? `, and in ${lastYear} it ranks #${rankNow + 1} among named groups so far` : ""}.`,
      states.length ? `Strongest in ${states.slice(0, 2).map(([st, v]) => `${st} (${pct(v / total)})`).join(" and ")}; active in ${p.states} states.` : "",
      maker !== "Other" ? (mShare >= 0.7 ? `A ${maker} house: ${pct(mShare)} of its awarded turbines are ${maker}.` : mShare >= 0.5 ? `Leans to ${maker} (${pct(mShare)}), with other makers for the rest.` : `Multi-vendor: no maker above half (largest ${maker}, ${pct(mShare)}).`) : "",
      p.quality_pct_avg != null ? `Its sites average ${p.quality_pct_avg}% site quality, ${p.quality_pct_avg >= mktQuality ? `${(p.quality_pct_avg - mktQuality).toFixed(0)} points above` : `${(mktQuality - p.quality_pct_avg).toFixed(0)} points below`} the auction average: ${p.quality_pct_avg >= mktQuality ? "windier sites, smaller correction bonus" : "weaker sites that it can still bid competitively, with a larger correction bonus"}.` : "",
      `Median award ${p.median_award_mw} MW, against ${au.median_award_mw} MW across all awards: ${p.median_award_mw > au.median_award_mw * 1.2 ? "fewer, larger projects" : p.median_award_mw < au.median_award_mw * 0.8 ? "many smaller projects" : "typical project sizes"}.`,
      p.realised_share != null ? `${pct(Math.min(1, p.realised_share))} of the turbines it won more than three years ago are already running.` : "",
    ].filter(Boolean);
    const caveats: ReactNode[] = [
      office > 0.05 ? `${pct(office)} of this capacity is assigned through office addresses (likely, not certain).` : "",
      reported.length ? `Checked against ${reported.length} company announcement${reported.length > 1 ? "s" : ""}: we see ${pct(sum(reported.map((r) => r.ours_mw)) / sum(reported.map((r) => r.reported_mw)))} of the announced capacity.` : "",
      "Projects bought or sold after the award count for the bidder; partner projects may be split differently by the companies themselves.",
    ].filter(Boolean);
    return { points, caveats };
  };

  return (
    <>
      <Chapter id="price" n={2} title="The price of wind">
        Since 2019, {rounds.length} onshore auction rounds awarded {mw(totalKw / 1000)}. Prices rose to the
        legal ceiling in 2023, then competition came back and pushed them to their lowest level since 2018.
      </Chapter>

      <Section
        id="auctions"
        eyebrow="Onshore wind auctions"
        title={`Award prices peaked at ${peak.avg_ct.toFixed(2)} ct/kWh in ${peak.bid_date.slice(0, 4)} and fell to ${last.avg_ct.toFixed(2)} ct; after the site correction projects receive about ${last.received_ct_est?.toFixed(2) ?? "–"} ct`}
        subtitle="Every round since May 2019: what projects bid, the legal ceiling, and the estimated value they receive once the EEG corrects it for their site."
        asOf={date}
        source={source}
        takeaways={[
          `From the ${roundLabel(peak.bid_date)} peak to ${roundLabel(last.bid_date)}, the average award fell by ${pct(1 - last.avg_ct / peak.avg_ct)}, to ${(last.avg_ct - first.avg_ct > 0 ? "above" : "below")} the level of ${first.bid_date.slice(0, 4)} (${first.avg_ct.toFixed(2)} ct).`,
          last.min_ct != null && last.max_ct != null ? `The latest round spanned only ${(last.max_ct - last.min_ct).toFixed(2)} ct from lowest to highest award, far below the ${last.ceiling_ct?.toFixed(2)} ct ceiling: prices are now set by competition, not the cap.` : "",
          `The EEG correction adds about ${pct((last.correction_factor_avg ?? 1) - 1)} on top: the average awarded site is weaker than the reference site.`,
        ].filter(Boolean)}
        caveats={["Single bids are not published; the received value is the round average times the estimated correction factor."]}
      >
        <AuctionPrices a={au} />
      </Section>

      <Chapter id="where" n={3} title="Where the wind farms go">
        Awards follow permits, and permits follow land. Watch the map move as the south and west
        catch up with the windy north and east.
      </Chapter>

      <Section
        id="auction-map"
        eyebrow="Where the awards went"
        title={`In ${years[yFull]}, ${topStates.map(([st]) => st).join(", ")} took ${pct(sum(topStates.map(([, v]) => v)))} of the awarded capacity`}
        subtitle="Press play: every awarded project since May 2019, round by round. Blue: the selected round; grey: everything awarded before."
        asOf={date}
        source={source}
        takeaways={[
          `Biggest gains in share from ${years[0]} to ${years[yFull]}: ${gains.slice(0, 2).map(([st, d]) => `${st} (${d >= 0 ? "+" : ""}${Math.round(d * 100)} points)`).join(", ")}.`,
          `Baden-Württemberg and Bayern together: ${pct(south(s0))} of the capacity in ${years[0]}, ${pct(south(sF))} in ${years[yFull]}.`,
          `${mw(sum(rounds.map((r) => r.list_kw)) / 1000)} awarded in ${rounds.length} rounds; the largest single round was ${roundLabel(rounds.reduce((m, r) => (r.list_kw > m.list_kw ? r : m), rounds[0]).bid_date)}.`,
        ]}
        caveats={["Awards of bidders that are not companies have no public location and are missing from the map (about 4 %)."]}
      >
        <AuctionMovie a={au} geo={data.districts} />
      </Section>

      <Section
        id="site-quality"
        eyebrow="Merit order by wind"
        title={`Awarded projects average about ${Math.round(wavg("full_load_hours_avg")).toLocaleString("en-GB")} full-load hours at ${wavg("quality_pct_avg").toFixed(0)}% site quality`}
        subtitle="Every awarded project, rated with DWD wind data: which sites win, how good they are, and the correction factor they earn."
        note="Full-load hours, site quality and correction factors are model estimates."
        asOf={date}
        source={<>Source: Bundesnetzagentur (awards), Marktstammdatenregister as of {date} (turbines), Deutscher Wetterdienst (wind, CC BY 4.0). Data processed.</>}
        takeaways={[
          "The average awarded site barely changes from round to round: what changes is the price, not the wind.",
          `Average correction factor ${wavg("correction_factor_avg").toFixed(2)}: the typical winner sits well below the EEG reference site, and the correction lifts its pay accordingly.`,
          au.model.calibration?.n ? `Site quality is calibrated with ${au.model.calibration.n.toLocaleString("en-GB")} turbines whose operators declare it in MaStR (median ${au.model.calibration.median_declared}%); the raw wind model read ${Math.round(((1 / au.model.calibration.factor) - 1) * 100)}% too high.` : "",
          "Each round's merit order runs from about 4,000 to 2,000 full-load hours: very different sites win side by side.",
        ]}
        caveats={[
          "Estimates from a simple model (DWD wind 1981–2000, generic power curve, 12 % losses, no curtailment); compare sites and rounds, not single values.",
          au.model.calibration?.correlation != null ? `Model and declared site quality correlate at ${au.model.calibration.correlation}: good for averages, rough for single projects. Full-load hours are not calibrated and may be 10–20 % high.` : "",
        ].filter(Boolean)}
      >
        <AuctionYield a={au} />
      </Section>

      <Chapter id="who" n={4} title="Who wins">
        Developers and independent power producers win most of the capacity; utilities and Stadtwerke
        play a small part. Pick a year, follow the race, then zoom into a single company.
      </Chapter>

      <Section
        id="winners"
        eyebrow={`Auction winners ${lastYear}`}
        title={`So far in ${lastYear}, ${topNow.map((x) => x.group).join(", ")} lead the named winners`}
        subtitle="Awarded capacity by company group, with citizen wind farms and unknown owners as their own bars. Checked against what the companies announce."
        asOf={date}
        source={source}
        takeaways={[
          `${topNow[0]?.group} won ${mw((topNow[0]?.kw ?? 0) / 1000)} in ${lastYear} so far, ${pct(topNow[0]?.share ?? 0)} of the year's capacity.`,
          `Owners are found by company name (${pct(att.name / attT)}), office address (${pct(att.office / attT)}) and by hand (${pct(att.reviewed / attT)}); ${pct(att.none / attT)} stays unknown.`,
          `Where a company bids under its own name, our totals match its announcements to the MW.`,
        ]}
        caveats={["Groups that bid through neutral project companies are still undercounted; see the comparison table."]}
      >
        <div className="space-y-10">
          <AuctionWinners a={au} brands={data.stats.wind_industry.brands} />
          <AuctionCrossCheck a={au} />
        </div>
      </Section>

      <Section
        id="auction-race"
        eyebrow="Since 2019"
        title={`Among known bidders, developers and IPPs won ${pct(devKnown(yi))} of the capacity in ${lastYear}, after ${pct(devKnown(0))} in ${years[0]}`}
        subtitle="Press play: who won the most auction capacity, year by year, and how the cake is shared."
        note={`The ${lastYear} figures cover the rounds awarded so far.`}
        asOf={date}
        source={source}
        takeaways={[
          `Since ${years[0]}: developers & IPPs at least ${pct(catAll("developer"))}, citizen & local ${pct(catAll("citizen"))}, utilities ${pct(catAll("utility"))}, Stadtwerke ${pct(catAll("municipal"))} of all awarded capacity.`,
          `The largest named winners since ${years[0]}: ${au.winners_by_year.all.filter((x) => !x.bucket).slice(0, 3).map((x) => `${x.group} (${mw(x.kw / 1000)})`).join(", ")}.`,
        ]}
        caveats={[`${pct(au.unattributed_share)} of the capacity has no known owner; most of it likely belongs to developers' project companies.`]}
      >
        <div className="space-y-12">
          <AuctionRace a={au} />
          <AuctionCake a={au} />
        </div>
      </Section>

      <Section
        id="company"
        eyebrow="Company deep dive"
        title="Pick a company: where it has won, year by year"
        subtitle="Each dot is one award, coloured by year (the running year in orange). Key figures and takeaways update with the company."
        asOf={date}
        source={source}
      >
        <CompanyMap
          a={au}
          geo={data.districts}
          profiles={au.company_profiles}
          years={au.race.years}
          takeaways={companyTakeaways}
          stats={(p) => (
            <>
              <Stat label="Site quality (est.)" value={p.quality_pct_avg == null ? "–" : `${p.quality_pct_avg}%`} sub={p.full_load_hours_avg ? `≈ ${p.full_load_hours_avg.toLocaleString("en-GB")} full-load hours` : undefined} />
              <Stat label="Median award" value={`${p.median_award_mw} MW`} sub={`${p.states} states`} />
              <Stat label="Turbine maker" value={Object.keys(p.kw_by_maker)[0] ?? "–"} sub={(() => { const m = Object.values(p.kw_by_maker); const t = m.reduce((x, y) => x + y, 0); return t ? `${Math.round((m[0] / t) * 100)}% of its turbines` : undefined; })()} />
            </>
          )}
        />
      </Section>

      <Section
        id="partners"
        eyebrow="Turbines and partners"
        title={houses.length ? `${houses.slice(0, 3).map((h) => `${h.g} builds ${h.m}`).join(", ")}: many developers stick to one maker` : "Which turbines the winners choose"}
        subtitle="Turbine makers in each company's awarded projects, as registered in MaStR."
        asOf={date}
        source={source}
        takeaways={[
          houses.length ? `Single-maker houses (≥ 70 %): ${houses.map((h) => `${h.g} (${h.m} ${pct(h.s)})`).join(", ")}.` : "",
          multi.length ? `Multi-vendor buyers: ${multi.map((m) => m.g).join(", ")}.` : "",
          "Alterric's Enercon preference has a reason: the Aloys Wobben Stiftung, Enercon's owner, co-owns Alterric.",
          "Framework agreements and repeat orders lower prices and planning risk, which matters when every tenth of a cent counts.",
        ].filter(Boolean)}
        caveats={["The maker is what the developer registered for the planned turbines; it can change before construction."]}
      >
        <TurbinePartners a={au} brands={data.stats.wind_industry.brands} />
      </Section>

      {data.solar && data.solar.cross_tech.length > 0 && (
        <Section
          id="wind-and-solar"
          eyebrow="Wind and solar"
          title={(() => { const both = data.solar.cross_tech.filter((c) => c.wind_kw_since_2023 > 0 && c.solar_kw_since_2023 > 0); return `${both.length} of the larger groups win in both wind and solar auctions`; })()}
          subtitle="Awarded capacity since 2023 per company group in onshore wind and ground-mounted solar auctions."
          asOf={date}
          source={source}
          takeaways={crossTakeaways(data)}
          caveats={["Groups found by name and office address; solar attribution is weaker than wind (more project companies)."]}
        >
          <CrossTech data={data} />
        </Section>
      )}

      <Chapter id="why" n={5} title="Why developers win">
        Lean teams, project finance and fast decisions beat balance sheets. The data shows the
        pattern; the assessment below explains it.
      </Chapter>

      {au.success && <SuccessSection data={data} date={date} source={source} />}

      <Section
        id="players"
        eyebrow="Developers vs utilities"
        title={`Utilities and Stadtwerke won ${pct(catAll("utility") + catAll("municipal"))} of auction capacity since ${years[0]}; developers and IPPs at least ${pct(catAll("developer"))}`}
        subtitle="Who owns the turbines that came out of the auctions, what the data shows about each type of bidder, and why lean developers keep winning."
        asOf={date}
        source={source}
        takeaways={[
          `Utilities submit few, large bids: median award ${au.drivers.utility.median_award_mw ?? "–"} MW from ${au.drivers.utility.distinct_bidders} companies, against ${au.drivers.developer.median_award_mw ?? "–"} MW from ${au.drivers.developer.distinct_bidders} developer companies.`,
          `Speed is not the difference: bid to operation takes about ${au.drivers.developer.median_months_to_operation ?? "–"} months for developers and ${au.drivers.utility.median_months_to_operation ?? "–"} for utilities.`,
          `Developers win on weaker sites too (site quality ${au.drivers.developer.quality_pct_avg ?? "–"}% vs Stadtwerke ${au.drivers.municipal.quality_pct_avg ?? "–"}%), which takes a low cost base.`,
        ]}
        caveats={["The driver matrix is an editorial assessment, not measured data."]}
      >
        <AuctionPlayers a={au} />
      </Section>
    </>
  );
}
