import { NextResponse } from "next/server";
import { lookupBuilding } from "../../../lib/nyc";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const bbl = p.get("bbl") ?? "";
  if (!/^\d{10}$/.test(bbl)) return NextResponse.json({ error: "Invalid BBL" }, { status: 400 });
  const report = await lookupBuilding({
    bbl,
    bin: p.get("bin"),
    label: p.get("label") ?? "",
    borough: p.get("borough") ?? "",
  });
  return NextResponse.json(report);
}
