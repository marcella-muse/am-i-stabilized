import { describe, expect, it } from "vitest";
import { evaluate, impliedIaiSpend, thresholdFor, type BuildingFacts, type TenantAnswers } from "../lib/engine";
import { determinationLetter, rentHistoryEmail, rec1Guide } from "../lib/documents";

const prewar12: BuildingFacts = { yearBuilt: 1928, residentialUnits: 12, buildingClass: "C1", j51: false, hpdRegistered: true };
const base: TenantAnswers = {
  leaseHasRider: "unsure",
  moveInDate: null,
  currentRent: null,
  lastRegisteredRent: null,
  lastRegisteredYear: null,
  rentHistory: "not_requested",
  coopOrCondoUnit: "no",
  gutRenovationKnown: "unsure",
  unitsOverride: null,
};

describe("coverage basis", () => {
  it("pre-1974 + 6 units is presumptively covered", () => {
    const v = evaluate(prewar12, base);
    expect(v.coverageBasis).toBe("age_and_size");
    expect(["moderate", "strong"]).toContain(v.band);
  });

  it("post-1974 with no tax benefit is unlikely", () => {
    const v = evaluate({ ...prewar12, yearBuilt: 2005 }, base);
    expect(v.coverageBasis).toBe("none");
    expect(v.band).toBe("unlikely");
  });

  it("pre-1974 but under 6 units is unlikely", () => {
    const v = evaluate({ ...prewar12, residentialUnits: 4 }, base);
    expect(v.band).toBe("unlikely");
  });

  it("tenant can correct the unit count", () => {
    const v = evaluate({ ...prewar12, residentialUnits: 4 }, { ...base, unitsOverride: 8 });
    expect(v.coverageBasis).toBe("age_and_size");
  });

  it("J-51 creates a basis for a newer building", () => {
    const v = evaluate({ ...prewar12, yearBuilt: 1990, j51: true }, base);
    expect(v.coverageBasis).toBe("tax_benefit");
    expect(v.band).toBe("moderate");
  });

  it("missing building facts become an unknown, not a 'no'", () => {
    const v = evaluate({ ...prewar12, yearBuilt: null, residentialUnits: null }, base);
    expect(v.coverageBasis).toBe("unknown");
    expect(v.unknowns.map((u) => u.id)).toContain("building_facts");
  });
});

describe("the canonical case: prewar walk-up, REG NOT FOUND, low last registered rent", () => {
  // Typical pattern: 1928 / 12 units / C1, moved in after 2019,
  // history shows a last stabilized rent of $900, then REG NOT FOUND, no exit reason.
  const answers: TenantAnswers = {
    ...base,
    leaseHasRider: "no",
    moveInDate: "2021-09-01",
    currentRent: 2000,
    lastRegisteredRent: 900,
    lastRegisteredYear: 2015,
    rentHistory: "reg_not_found",
    gutRenovationKnown: "no",
  };
  const v = evaluate(prewar12, answers);

  it("lands in the strong band", () => expect(v.band).toBe("strong"));

  it("rates high-rent vacancy deregulation as unlikely and quantifies why", () => {
    const hrv = v.exits.find((x) => x.exit === "High-rent vacancy deregulation")!;
    expect(hrv.status).toBe("unlikely");
    expect(hrv.explanation).toMatch(/\$900/);
  });

  it("rules out tax-benefit expiration", () => {
    expect(v.exits.find((x) => x.exit === "Tax benefit expired")!.status).toBe("ruled_out");
  });

  it("still flags the prior-tenancy gap honestly", () => {
    expect(v.unknowns.map((u) => u.id)).toContain("prior_tenancy");
    expect(v.range[1]).toBeLessThan(100);
  });
});

describe("deregulation screen", () => {
  it("rules out vacancy dereg when registered RS after HSTPA", () => {
    const v = evaluate(prewar12, { ...base, rentHistory: "registered_rs", lastRegisteredRent: 1400, lastRegisteredYear: 2021 });
    expect(v.exits.find((x) => x.exit === "High-rent vacancy deregulation")!.status).toBe("ruled_out");
    expect(v.band).toBe("strong");
  });

  it("treats a registered exemption close to the threshold as a real risk", () => {
    const v = evaluate(prewar12, { ...base, rentHistory: "exempt_with_reason", lastRegisteredRent: 2200, lastRegisteredYear: 2014 });
    expect(v.exits.find((x) => x.exit === "High-rent vacancy deregulation")!.status).toBe("possible");
    expect(["weak", "moderate"]).toContain(v.band);
  });

  it("a rider pushes the signal up", () => {
    const a = evaluate(prewar12, base).score;
    const b = evaluate(prewar12, { ...base, leaseHasRider: "yes" }).score;
    expect(b).toBeGreaterThan(a);
  });

  it("never claims certainty", () => {
    const v = evaluate({ ...prewar12, j51: true }, { ...base, leaseHasRider: "yes", rentHistory: "registered_rs", lastRegisteredYear: 2024, lastRegisteredRent: 1500 });
    expect(v.score).toBeLessThanOrEqual(97);
  });
});

describe("helpers", () => {
  it("thresholds by era", () => {
    expect(thresholdFor(2005)).toBe(2000);
    expect(thresholdFor(2013)).toBe(2500);
    expect(thresholdFor(2017)).toBe(2700);
  });
  it("IAI math", () => {
    expect(impliedIaiSpend(900, 2700, 12)).toBe((2700 - 1080) * 40);
    expect(impliedIaiSpend(3000, 2700, 14)).toBe(0);
  });
});

describe("documents", () => {
  const t = {
    fullName: "Test Tenant", address: "1 Example St", apt: "4F", borough: "Queens", zip: "11101",
    email: "t@example.com", phone: "555-0100", ownerName: "Example LLC", moveInDate: "2021-09-01", currentRent: "2000",
  };
  it("fills the email", () => {
    const e = rentHistoryEmail(t);
    expect(e.subject).toContain("Apt 4F");
    expect(e.body).toContain("Test Tenant");
  });
  it("leaves visible placeholders for blanks", () => {
    expect(rec1Guide({ ...t, fullName: "" })).toContain("[your full name]");
  });
  it("determination letter carries the not-legal-advice note", () => {
    expect(determinationLetter(t)).toMatch(/Not legal advice/);
  });
});
