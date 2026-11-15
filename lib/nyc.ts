/**
 * Public NYC data lookups. All free, no keys required (an optional Socrata
 * app token raises rate limits: set SOCRATA_APP_TOKEN).
 *
 * Every lookup degrades gracefully: if a dataset errors, we return null for
 * that field and the engine treats it as "unknown" rather than "no".
 */
import type { BuildingFacts } from "./engine";

const SOCRATA = "https://data.cityofnewyork.us/resource";
const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2";

export const DATASETS = {
  pluto: "64uk-42ks", // Primary Land Use Tax Lot Output
  hpdRegistrations: "tesw-yqqr", // HPD Multiple Dwelling Registrations
  hpdViolations: "wvxf-dwi5", // HPD Housing Maintenance Code Violations
  j51Historical: "y7az-s7wc", // J-51 Exemption & Abatement (pre-2019, not updated)
} as const;

export interface AddressMatch {
  label: string;
  bbl: string;
  bin: string | null;
  borough: string;
}

export interface BuildingReport {
  match: AddressMatch;
  facts: BuildingFacts;
  ownerName: string | null;
  address: string | null;
  openViolations: number | null;
  sources: { name: string; url: string; ok: boolean }[];
}

function socrataHeaders(): HeadersInit {
  const token = process.env.SOCRATA_APP_TOKEN;
  return token ? { "X-App-Token": token } : {};
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: socrataHeaders(), next: { revalidate: 60 * 60 * 24 } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export function splitBbl(bbl: string) {
  return { boro: bbl.slice(0, 1), block: String(Number(bbl.slice(1, 6))), lot: String(Number(bbl.slice(6, 10))) };
}

/** As-you-type suggestions (GeoSearch autocomplete). Returns [] on any failure. */
export async function autocompleteAddress(text: string, signal?: AbortSignal): Promise<AddressMatch[]> {
  try {
    const res = await fetch(`${GEOSEARCH}/autocomplete?text=${encodeURIComponent(text)}`, { signal });
    if (!res.ok) return [];
    // One entry per building: the city lists alternate spellings (B'WAY / BROADWAY) separately.
    // Keep the fullest spelling of each building's name.
    const best = new Map<string, AddressMatch>();
    for (const m of toMatches(await res.json())) {
      const prev = best.get(m.bbl);
      if (!prev || m.label.length > prev.label.length) best.set(m.bbl, m);
    }
    return [...best.values()].slice(0, 6);
  } catch {
    return [];
  }
}

function toMatches(data: any): AddressMatch[] {
  return (data.features ?? [])
    .map((f: any) => {
      const pad = f.properties?.addendum?.pad ?? {};
      return { label: f.properties?.label ?? "", bbl: pad.bbl ?? "", bin: pad.bin ?? null, borough: f.properties?.borough ?? "" } as AddressMatch;
    })
    .filter((m: AddressMatch) => /^\d{10}$/.test(m.bbl));
}

/** Address → candidate BBLs. Returns several candidates, since streets can have more than one name or spelling. */
export async function searchAddress(text: string): Promise<AddressMatch[]> {
  const url = `${GEOSEARCH}/search?text=${encodeURIComponent(text)}&size=5`;
  const data = await getJson<any>(url);
  return (data.features ?? [])
    .map((f: any) => {
      const pad = f.properties?.addendum?.pad ?? {};
      return {
        label: f.properties?.label ?? "",
        bbl: pad.bbl ?? "",
        bin: pad.bin ?? null,
        borough: f.properties?.borough ?? "",
      } as AddressMatch;
    })
    .filter((m: AddressMatch) => /^\d{10}$/.test(m.bbl));
}

export async function lookupBuilding(match: AddressMatch): Promise<BuildingReport> {
  const { boro, block, lot } = splitBbl(match.bbl);
  const sources: BuildingReport["sources"] = [];

  const [pluto, hpd, viol, j51] = await Promise.allSettled([
    getJson<any[]>(`${SOCRATA}/${DATASETS.pluto}.json?bbl=${match.bbl}`),
    getJson<any[]>(`${SOCRATA}/${DATASETS.hpdRegistrations}.json?boroid=${boro}&block=${block}&lot=${lot}&$limit=5`),
    getJson<any[]>(
      `${SOCRATA}/${DATASETS.hpdViolations}.json?$select=count(*)&boroid=${boro}&block=${block}&lot=${lot}&violationstatus=Open`
    ),
    getJson<any[]>(`${SOCRATA}/${DATASETS.j51Historical}.json?$where=${encodeURIComponent(j51Where(boro, block, lot))}&$limit=1`),
  ]);

  const src = (name: string, id: string, r: PromiseSettledResult<unknown>) =>
    sources.push({ name, url: `https://data.cityofnewyork.us/d/${id}`, ok: r.status === "fulfilled" });
  src("PLUTO (NYC City Planning)", DATASETS.pluto, pluto);
  src("HPD building registrations", DATASETS.hpdRegistrations, hpd);
  src("HPD violations", DATASETS.hpdViolations, viol);
  src("J-51 tax benefit records (through 2019)", DATASETS.j51Historical, j51);

  const p = pluto.status === "fulfilled" ? pluto.value[0] : undefined;

  const facts: BuildingFacts = {
    yearBuilt: p?.yearbuilt ? Number(p.yearbuilt) || null : null,
    residentialUnits: p?.unitsres != null ? Number(p.unitsres) : null,
    buildingClass: p?.bldgclass ?? null,
    j51: j51.status === "fulfilled" ? j51.value.length > 0 : null,
    hpdRegistered: hpd.status === "fulfilled" ? hpd.value.length > 0 : null,
  };

  return {
    match,
    facts,
    ownerName: p?.ownername ?? null,
    address: p?.address ?? null,
    openViolations: viol.status === "fulfilled" ? Number(viol.value[0]?.count ?? 0) : null,
    sources,
  };
}

/**
 * J-51 historical dataset: borough is the field "b", block and lot are unpadded
 * text (verified Nov 2026). If the query fails, j51 comes back null (unknown),
 * never a false "no".
 */
function j51Where(boro: string, block: string, lot: string) {
  return `b='${boro}' AND block='${block}' AND lot='${lot}'`;
}
