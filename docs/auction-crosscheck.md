# Auction winners: cross-check with company publications (1 Nov 2026)

Our winners come from the BNetzA award lists, grouped by bidder name
(`pipeline/config/auction_groups.yaml`). This note compares them with what the
companies themselves publish (press releases, project pages, permits).

## Result in one line

Where a company bids under its own name, our figures match its announcements
to the MW. Where it bids through neutrally named project companies, we
undercount it, sometimes by half. One group rule was wrong and is fixed (UGE → UKA).

## Round totals: ours vs company-reported

| Company | Round | Ours (MW) | Company says | Verdict | Source |
|---|---|---|---|---|---|
| RWE | Aug 2026 | 119.0 (Jüchen 84, Seedorf 35) | 119 MW (Jüchen 3: 84, Seedorf: 35) | ✅ exact | [RWE, 18 Sep 2026](https://www.rwe.com/investor-relations/finanzkalender-und-veroeffentlichungen/news-und-ad-hoc-mitteilungen/news/news-2026-09-18_a/) |
| PNE | May 2026 | 108.0 | 108 MW (Beerfelde 100.8, Hassendorf 7.2) | ✅ exact | [energyglobal, 30 Jun 2026](https://www.energyglobal.com/wind/30062026/pne-receives-contracts-from-onshore-wind-energy-tender-in-germany/) |
| ABO Energy | May 2026 | 61.4 | 61.4 MW | ✅ exact | [goldesel](https://goldesel.de/aktien/news/abo-energy-erhalt-windkraft-zuschlage-uber-614-mw-insider-verkauft-aktien) |
| ABO Energy | Aug 2026 | 99.0 | 102.2 MW (Bentheim Süd 46.2, Rhein-Mosel 28, Losheim 28) | ✅ same projects; Rhein-Mosel is 24.8 MW in the award list, 28 MW in ABO's current turbine plan | [inspenet, 25 Sep 2026](https://inspenet.com/en/news/abo-energy-wins-wind-power-tender-in-germany/) |
| EnBW | May 2025 | 92.0 | 92 MW, three projects | ✅ exact (secondary source) | [PFI](https://www.pfie.com/emea/2282928/pfi-help) |
| Alterric | May 2026 | 177.3 | 242 MW, six projects | ⚠️ 64.8 MW missing: the Osterfeld project was bid by **AEZ Planungs GmbH & Co. KG** (177.3 + 64.8 = 242.1) | [Power Technology](https://www.power-technology.com/news/alterric-secures-242mw-six-projects/) |
| Qualitas Energy | May 2026 | 106.2 | 113.2 MW, 3 projects, 16 turbines | ⚠️ ~7 MW under another name | [Qualitas PR, 30 Jun 2026](https://qualitasenergy.com/wp-content/uploads/260630_PR_Qualitas-Energy-secures-113-MW-in-latest-onshore-wind-energy-tender-in-Germany.pdf) |
| Qualitas Energy | Feb 2026 | 91.4 | 126 MW | ⚠️ ~35 MW under other names | [energyglobal, 17 Apr 2026](https://www.energyglobal.com/wind/17042026/qualitas-energy-secures-126-mw-in-onshore-wind-energy-tender-in-germany/amp/) |
| Qualitas Energy | Aug 2025 | 21.6 | 43 MW | ⚠️ half missing | [renewable-energy-industry](https://www.renewable-energy-industry.com/news/press-releases/pm-8630-qualitas-energy-secures-43-mw-in-latest-onshore-wind-energy-tender) |
| wpd | Nov 2025 | 317.4 | ~587 MW, 23 projects | ⚠️ ~270 MW under other names | [wpd PR, 13 Jan 2026](https://www.wpd.de/wp-content/uploads/2026/01/20260113_wpd-Pressemitteilung_wpd-startet-mit-Rekordergebnis-ins-Jahr-2026docx-2.pdf) |
| wpd | all of 2025 | 506.9 | 1,135 MW | ⚠️ we see 45 % | same |
| UKA | Aug 2025 | 54.8 before fix → 523.1 after | > 700 MW | ❌→⚠️ UGE companies were missing (fixed); rest likely partner projects | [solarserver](https://www.solarserver.de/2026/01/14/uka-gruppe-will-an-land-jaehrlich-1-gw-windenergie-zubauen/) |
| UKA | Feb 2026 | 48.7 before fix → 372.5 after | ~600 MW incl. partner projects | ❌→⚠️ as above | [Windtech](https://www.windtech-international.com/projects-and-contracts/uka-group-secures-over-600mw-in-german-onshore-wind-tender) |

## Single projects found on company or permit pages

| Award (bidder in list) | Public evidence | Verdict |
|---|---|---|
| UGE Papenburg (60.9 MW, Aug 2025) | UKA's 140 MW wind farm on the Mercedes-Benz test site in Papenburg, 20 Nordex turbines ([Nordex](https://www.nordex-online.com/en/?p=52152)) | **UKA**, not a separate "UGE" |
| UGE Schäcksdorf Drei (54.8 MW, Feb 2025) | Brandenburg permit applicant at Schäcksdorf is UKA ([uvp-verbund](https://www.uvp-verbund.de/documents-ige-ng/igc_bb/94a49a00-eb3f-4989-b26d-68b22e011c4e/Bekanntmachung%20GB%2050.014.00_24.pdf)) | **UKA** |
| UGE … companies in general | registered in Lohmen, Amtsgericht Rostock ([firminform](https://www.firminform.de/unternehmen/UGE-Donop-GmbH-Co-KG-Umweltgerechte-Energie-Lohmen)), where UKA has an office | **UKA** (fixed in config) |
| QE Windpark Hillmersdorf (24.8 MW, Aug 2026) | permit to Qualitas Energy Projekt GmbH, Fichtwald, Vestas V162 ([LfU Brandenburg](https://mleuv-daten.brandenburg.de/bekanntmachungen/immission/sued/Sued-G03825-Genehmigungsbescheid.pdf)) | ✅ Qualitas |
| WKN Windpark Beerfelde (100.8 MW, May 2026) | PNE / ENERCON Energiepark Beerfelde, 14 turbines ([blackridge](https://www.blackridgeresearch.com/news-releases/pne-group-secures-108-mw-in-german-onshore-wind-tender-with-beerfelde-and-hassendorf-projects)) | ✅ PNE (WKN = PNE subsidiary) |
| ABO Energy Windpark 33, Bad Bentheim (46.2 MW, Aug 2026) | ABO "Bentheim Süd", 7 × SG 6.6 MW | ✅ ABO |
| RWE, Jüchen (84 MW, Aug 2026) | RWE "Jüchen 3" | ✅ RWE |
| enercity Windpark Rohne, Schleife (24 MW, Nov 2024) | enercity's Schleife / Forst Rohne project, 4 turbines, 24 MW on the spoil heap ([solarserver](https://www.solarserver.de/2022/07/28/enercity-200-mw-windenergie-hochkippe-wald/)) | ✅ enercity |
| JUWI, Olsberg (62 MW, Nov 2025) | JUWI "Olsberg-Plackweg", 10 × Vestas V162 order ([JUWI](https://windpark.juwi.de/fileadmin/PM_Infoveranstaltung_Oktober_2024.pdf)) | ✅ JUWI |
| Alterric Bentstreek, Ebendorf, Durmersheim (May 2026) | named by Alterric among its six awarded projects | ✅ Alterric |
| AEZ Planungs, Osterfeld (64.8 MW, May 2026) | Alterric names Osterfeld as its project | ⚠️ bidder AEZ, claimed by Alterric (sale or partnership?) |
| Prowind Wiefelstede, wpd Jatznick, ENERTRAG Alpha II, EnBW Reinsfeld, Alterric Struvenhütten | no public project page found | ❔ consistent with the bidder name, not independently confirmed |

## What it means for the site

- Rankings of companies that bid under their own name (RWE, EnBW, PNE, ABO,
  enercity) are reliable.
- Groups that use neutral project companies (wpd, Qualitas, UKA partner
  projects, Alterric via AEZ) are undercounted; "Not attributed" holds their
  missing capacity. The site says so next to the chart.
- Fixed: "UGE … Umweltgerechte Energie" now counts as UKA, which makes UKA
  the largest named winner since 2019 (≈ 2.5 GW).
- Open: AEZ Planungs → Alterric? Would need the commercial register (general
  partner) or an Alterric statement; for now AEZ stays a separate developer.
- A reviewed mapping of project companies to groups, seeded from company
  press releases like the ones above, would close much of the gap (WP45b).
