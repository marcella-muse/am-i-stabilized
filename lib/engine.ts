/**
 * The "Am I stabilized?" rules engine.
 *
 * Deterministic, transparent, testable. No ML. Every point the engine moves
 * the confidence is recorded as a Reason the UI shows to the tenant, so the
 * verdict always explains itself.
 *
 * NOT LEGAL ADVICE. This estimates how strong the public-record signal is.
 * Only DHCR or a court can determine a unit's status.
 */

// ---------- Inputs ----------

export type Tri = "yes" | "no" | "unsure";

export interface BuildingFacts {
  yearBuilt: number | null; // PLUTO yearbuilt (0 / null = unknown)
  residentialUnits: number | null; // PLUTO unitsres
  buildingClass: string | null; // PLUTO bldgclass, e.g. "C1"
  j51: boolean | null; // ever received J-51 (null = couldn't check)
  hpdRegistered: boolean | null; // has an HPD multiple-dwelling registration
}

export type RentHistoryStatus =
  | "not_requested" // tenant hasn't gotten their DHCR rent history yet
  | "registered_rs" // shows recent registrations as RS
  | "reg_not_found" // shows "REG NOT FOUND" for recent years, no exit reason
  | "exempt_with_reason" // shows an exempt/PE status WITH a stated reason (e.g. high-rent vacancy)
  | "never_registered"; // no registrations at all, ever

export interface TenantAnswers {
  leaseHasRider: Tri; // rent-stabilization rider attached to lease
  moveInDate: string | null; // ISO date
  currentRent: number | null;
  lastRegisteredRent: number | null; // last RS rent on the DHCR history, if any
  lastRegisteredYear: number | null;
  rentHistory: RentHistoryStatus;
  coopOrCondoUnit: Tri; // is this unit owned as a co-op/condo?
  gutRenovationKnown: Tri; // any knowledge of a full gut renovation of the building
  unitsOverride: number | null; // tenant's own count if PLUTO looks wrong
}

// ---------- Outputs ----------

export type Direction = "up" | "down" | "neutral";

export interface Reason {
  id: string;
  title: string;
  detail: string;
  direction: Direction;
  weight: number; // signed points applied to the score
}

export interface Unknown {
  id: string;
  question: string;
  whyItMatters: string;
  howToResolve: string;
}

export type Band = "strong" | "moderate" | "weak" | "unlikely";

export interface Verdict {
  band: Band;
  score: number; // 0–100, internal; UI shows the band + a range, not a point estimate
  range: [number, number];
  headline: string;
  coverageBasis: "age_and_size" | "tax_benefit" | "none" | "unknown";
  reasons: Reason[];
  unknowns: Unknown[];
  exits: ExitCheck[];
}

export interface ExitCheck {
  exit: string;
  status: "ruled_out" | "unlikely" | "possible" | "unknown";
  explanation: string;
}

// ---------- Constants (verify before launch; see README "Things to verify") ----------

/** HSTPA (Housing Stability and Tenant Protection Act) effective date. */
export const HSTPA_DATE = "2019-06-14";

/**
 * Approximate high-rent vacancy deregulation thresholds by period.
 * The legal rent had to reach this level on a vacancy for the unit to exit.
 * Abolished by HSTPA on 2019-06-14.
 */
export const DEREG_THRESHOLDS: { from: string; to: string; amount: number }[] = [
  { from: "1997-06-19", to: "2011-06-23", amount: 2000 },
  { from: "2011-06-24", to: "2015-06-14", amount: 2500 },
  // 2015 law: $2,700 base, then indexed annually by RGB one-year increases.
  { from: "2015-06-15", to: "2019-06-13", amount: 2700 },
];

/** Co-op / condo building classes in PLUTO. Coverage is more complicated there. */
const COOP_CONDO_CLASS = /^(C6|C8|D0|D4|R\d|RR)/i;

// ---------- Helpers ----------

export function isPreHSTPA(dateIso: string | null): boolean | null {
  if (!dateIso) return null;
  return dateIso < HSTPA_DATE;
}

/** Rough IAI spending a landlord would have needed to bridge rent R to threshold T on one vacancy. */
export function impliedIaiSpend(rent: number, threshold: number, unitsInBuilding: number): number {
  // Pre-2019: ~20% vacancy bonus, then IAI added 1/40th (≤35 units) or 1/60th (>35) of cost per month.
  const afterBonus = rent * 1.2;
  const gap = Math.max(0, threshold - afterBonus);
  const divisor = unitsInBuilding > 35 ? 60 : 40;
  return Math.round(gap * divisor);
}

const clamp = (n: number, lo = 2, hi = 97) => Math.max(lo, Math.min(hi, n));

// ---------- Engine ----------

export function evaluate(b: BuildingFacts, t: TenantAnswers): Verdict {
  const reasons: Reason[] = [];
  const unknowns: Unknown[] = [];
  const exits: ExitCheck[] = [];
  const add = (r: Reason) => reasons.push(r);

  const units = t.unitsOverride ?? b.residentialUnits;
  const year = b.yearBuilt && b.yearBuilt > 1800 ? b.yearBuilt : null;
  const classIsCoopCondo = b.buildingClass ? COOP_CONDO_CLASS.test(b.buildingClass) : false;

  // ---- 1. Coverage basis ----
  let score = 20; // prior for "a random NYC rental"
  let coverageBasis: Verdict["coverageBasis"] = "none";

  if (year !== null && units !== null) {
    if (year < 1974 && units >= 6) {
      coverageBasis = "age_and_size";
      score = 70;
      add({
        id: "age_size",
        title: `Built in ${year} with ${units} homes`,
        detail:
          "Buildings built before 1974 with 6 or more apartments are presumptively covered by rent stabilization. This is the single strongest public-record signal.",
        direction: "up",
        weight: 50,
      });
    } else if (year < 1974 && units < 6) {
      add({
        id: "too_small",
        title: `Only ${units} homes in the building`,
        detail:
          "Rent stabilization by building age generally applies only to buildings with 6 or more apartments. If the building has been combined with a neighbor on one lot, or the count is wrong, this can change.",
        direction: "down",
        weight: -10,
      });
      score = 10;
    } else {
      add({
        id: "post_1974",
        title: `Built in ${year}`,
        detail:
          "Buildings from 1974 onward are usually stabilized only if they took a tax benefit like 421-a or J-51.",
        direction: "neutral",
        weight: 0,
      });
    }
  } else {
    coverageBasis = "unknown";
    unknowns.push({
      id: "building_facts",
      question: "When was the building built and how many apartments does it have?",
      whyItMatters: "Age and size decide whether the building is presumptively covered.",
      howToResolve: "Check the building on NYC's ZoLa map or ask neighbors how many units there are.",
    });
  }

  if (b.j51 === true) {
    if (coverageBasis !== "age_and_size") {
      coverageBasis = "tax_benefit";
      score = Math.max(score, 60);
    } else {
      score += 3;
    }
    add({
      id: "j51",
      title: "The building received a J-51 tax benefit",
      detail:
        "Taking J-51 generally requires units to be stabilized, at least while the benefit lasts. Deregulating a unit while receiving J-51 has been ruled unlawful by New York's highest court.",
      direction: "up",
      weight: coverageBasis === "tax_benefit" ? 40 : 3,
    });
  } else if (b.j51 === null) {
    unknowns.push({
      id: "tax_benefit",
      question: "Has the building ever received 421-a or J-51?",
      whyItMatters:
        "A tax benefit can make units stabilized even in newer buildings, and blocks some deregulation routes.",
      howToResolve: "Look up the property on NYC Department of Finance's property tax bill search.",
    });
  }

  if (classIsCoopCondo || t.coopOrCondoUnit === "yes") {
    score -= 20;
    add({
      id: "coop_condo",
      title: "Co-op or condo ownership",
      detail:
        "Units in co-ops and condos can still be stabilized when rented, but the rules are different and more fact-specific. Treat this result as rougher than usual.",
      direction: "down",
      weight: -20,
    });
  }

  // ---- 2. Direct evidence from the tenant ----
  if (t.leaseHasRider === "yes") {
    score += 15;
    add({
      id: "rider",
      title: "Your lease came with a rent-stabilization rider",
      detail:
        "Landlords attach the rider to stabilized leases. It is strong evidence the landlord itself treated the unit as stabilized.",
      direction: "up",
      weight: 15,
    });
  } else if (t.leaseHasRider === "no" && coverageBasis !== "none") {
    add({
      id: "no_rider",
      title: "No rider on your lease",
      detail:
        "Missing riders are common in exactly the cases worth investigating — a landlord treating a unit as market-rate won't attach one. It doesn't count against you much on its own.",
      direction: "neutral",
      weight: 0,
    });
  }

  // ---- 3. Rent history interpretation ----
  switch (t.rentHistory) {
    case "registered_rs":
      score += 15;
      add({
        id: "hist_rs",
        title: "Your rent history shows recent stabilized registrations",
        detail: "The landlord has been telling the state this unit is rent stabilized.",
        direction: "up",
        weight: 15,
      });
      break;
    case "reg_not_found":
      score += coverageBasis === "age_and_size" ? 5 : 0;
      add({
        id: "hist_gap",
        title: '"REG NOT FOUND" with no exit reason',
        detail:
          '"REG NOT FOUND" is ambiguous: it can mean the landlord stopped registering a still-stabilized unit (not allowed), or that the unit left stabilization lawfully. What tips it toward you: there is no "exempt" marker and no stated deregulation reason on file, and the burden of proving a lawful exit is on the owner.',
        direction: coverageBasis === "age_and_size" ? "up" : "neutral",
        weight: coverageBasis === "age_and_size" ? 5 : 0,
      });
      break;
    case "exempt_with_reason":
      score -= 20;
      add({
        id: "hist_exempt",
        title: "Your rent history lists an exemption with a reason",
        detail:
          "The landlord registered a reason the unit left stabilization. That claim can still be wrong — the rent may never have legitimately reached the threshold — but it shifts the work to proving the exit was improper.",
        direction: "down",
        weight: -20,
      });
      break;
    case "never_registered":
      if (coverageBasis === "age_and_size") {
        add({
          id: "hist_never",
          title: "No registrations ever",
          detail:
            "A covered building that never registered is a red flag about the owner, not proof the unit is unregulated. It needs a lawyer's eye.",
          direction: "neutral",
          weight: 0,
        });
      } else {
        score -= 10;
      }
      break;
    case "not_requested":
      unknowns.push({
        id: "rent_history",
        question: "What does your apartment's official rent history show?",
        whyItMatters:
          "It's the best single piece of evidence: it shows what the landlord registered, and whether they ever claimed the unit left stabilization.",
        howToResolve: "Request it from DHCR — this tool drafts the request for you. It's free.",
      });
      break;
  }

  // ---- 4. Deregulation exits ----
  const movedInPre2019 = isPreHSTPA(t.moveInDate);
  if (movedInPre2019 === false && (coverageBasis === "age_and_size" || coverageBasis === "tax_benefit")) {
    add({
      id: "post_hstpa_movein",
      title: "You moved in after June 14, 2019",
      detail:
        "If the unit was still stabilized when the previous tenant left, your move-in could not have deregulated it — vacancy deregulation no longer existed. The question becomes whether it left before 2019.",
      direction: "up",
      weight: 4,
    });
    score += 4;
  }

  // 4a. High-rent vacancy deregulation (the big one)
  if (coverageBasis === "age_and_size" || coverageBasis === "tax_benefit") {
    if (t.lastRegisteredYear !== null && t.lastRegisteredYear >= 2020) {
      // Registered as RS after HSTPA → no vacancy since then could have deregulated it.
      exits.push({
        exit: "High-rent vacancy deregulation",
        status: "ruled_out",
        explanation:
          "The unit was still registered as stabilized after June 14, 2019, when vacancy deregulation was abolished. No later vacancy can have taken it out.",
      });
      score += 8;
    } else if (t.lastRegisteredRent !== null && t.lastRegisteredYear !== null) {
      const threshold = thresholdFor(t.lastRegisteredYear);
      const spend = impliedIaiSpend(t.lastRegisteredRent, threshold, units ?? 10);
      if (spend > 40000) {
        exits.push({
          exit: "High-rent vacancy deregulation",
          status: "unlikely",
          explanation: `To jump from the last registered rent ($${fmt(t.lastRegisteredRent)}) past the ~$${fmt(
            threshold
          )} threshold on a vacancy, the landlord would have needed roughly $${fmt(
            spend
          )} in documented apartment improvements. That's possible but large — owners must prove it with receipts.`,
        });
        score += 6;
      } else {
        exits.push({
          exit: "High-rent vacancy deregulation",
          status: "possible",
          explanation: `The gap from $${fmt(t.lastRegisteredRent)} to the ~$${fmt(
            threshold
          )} threshold could have been bridged with about $${fmt(spend)} in improvements. This is the scenario to investigate.`,
        });
        score -= 8;
      }
    } else {
      exits.push({
        exit: "High-rent vacancy deregulation",
        status: "unknown",
        explanation:
          "This is the most common way units left stabilization before June 2019. Your rent history will show the last stabilized rent, which tells us whether it was plausible.",
      });
    }

    // 4b. Tax-benefit expiration
    exits.push({
      exit: "Tax benefit expired",
      status: coverageBasis === "age_and_size" ? "ruled_out" : "possible",
      explanation:
        coverageBasis === "age_and_size"
          ? "Doesn't apply: your building is covered because of its age and size, not because of a tax benefit."
          : "If coverage came only from a tax benefit, units can sometimes leave when it ends — but only with proper lease notices.",
    });

    // 4c. Substantial rehabilitation
    exits.push({
      exit: "Substantial rehabilitation",
      status: t.gutRenovationKnown === "yes" ? "possible" : t.gutRenovationKnown === "no" ? "unlikely" : "unknown",
      explanation:
        "A building gutted and rebuilt (generally 75%+ of systems replaced) can be exempt. It's rare and the owner must prove it to DHCR.",
    });
    if (t.gutRenovationKnown === "yes") score -= 10;

    // 4d. High-income deregulation
    exits.push({
      exit: "High-income deregulation",
      status: t.rentHistory === "exempt_with_reason" ? "possible" : "unlikely",
      explanation:
        "Required a DHCR order based on a prior tenant's income and was abolished in 2019. If it happened, it would show up in the records.",
    });
  }

  // Prior-tenancy gap is the classic unknown.
  if (coverageBasis !== "none" && t.rentHistory !== "registered_rs") {
    unknowns.push({
      id: "prior_tenancy",
      question: "What happened between the last stabilized tenant and you?",
      whyItMatters:
        "This is where most deregulation claims live. If the landlord can show a lawful exit in that window, the picture changes.",
      howToResolve:
        "Your rent history plus any neighbor knowledge of prior tenants and renovations. A tenant lawyer can demand the landlord's records.",
    });
  }

  score = clamp(Math.round(score));
  const band: Band = score >= 75 ? "strong" : score >= 50 ? "moderate" : score >= 25 ? "weak" : "unlikely";
  const spread = unknowns.length >= 2 ? 12 : unknowns.length === 1 ? 8 : 5;
  const range: [number, number] = [clamp(score - spread, 1, 99), clamp(score + spread, 1, 99)];

  return { band, score, range, headline: headlineFor(band), coverageBasis, reasons, unknowns, exits };
}

export function thresholdFor(year: number): number {
  const d = `${year}-07-01`;
  const hit = DEREG_THRESHOLDS.find((x) => d >= x.from && d <= x.to);
  return hit ? hit.amount : 2000;
}

function headlineFor(band: Band): string {
  switch (band) {
    case "strong":
      return "The public record strongly suggests your apartment should be rent stabilized.";
    case "moderate":
      return "There's a real case your apartment should be rent stabilized — with open questions.";
    case "weak":
      return "Some signs point to stabilization, but the record is thin or mixed.";
    case "unlikely":
      return "Based on what we can see, stabilization looks unlikely — but there are exceptions.";
  }
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
