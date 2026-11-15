import { NextResponse } from "next/server";
import { searchAddress } from "../../../lib/nyc";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 4) return NextResponse.json({ matches: [] });
  try {
    return NextResponse.json({ matches: await searchAddress(q) });
  } catch {
    return NextResponse.json({ error: "Address search is unavailable right now." }, { status: 502 });
  }
}
