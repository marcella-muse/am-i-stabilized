/**
 * Optional LLM layer. Rewrites the engine's structured verdict as a warm,
 * plain-English explanation. It NEVER decides coverage: the band, reasons and
 * exits come from lib/engine.ts and the prompt forbids changing them.
 * If ANTHROPIC_API_KEY is unset, returns 204 and the UI uses its built-in text.
 * Privacy: only the verdict object is sent — no name, address or contact info.
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You explain rent-stabilization screening results to NYC tenants who may be anxious.
You receive a JSON verdict produced by a deterministic rules engine.
Rules:
- Do not change the verdict band, add reasons, or invent facts. Explain only what's in the JSON.
- Never say the apartment IS or IS NOT stabilized. Say what the public record suggests.
- Never advise withholding rent. Paying rent on time protects the tenant while this gets resolved.
- Name the single biggest open question and how to resolve it.
- Plain, calm, 2nd person. 150–220 words. No headings, no bullet lists.
- End with one sentence noting this is not legal advice and a tenant lawyer or tenant organization can review it free or at low cost.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return new NextResponse(null, { status: 204 });
  const { verdict } = await req.json();
  if (!verdict?.band) return NextResponse.json({ error: "Missing verdict" }, { status: 400 });
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(verdict) }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return NextResponse.json({ text });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
