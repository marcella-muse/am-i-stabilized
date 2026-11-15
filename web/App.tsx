import { useEffect, useMemo, useRef, useState } from "react";
import { evaluate, type BuildingFacts, type TenantAnswers, type Verdict, type Tri } from "../lib/engine";
import { determinationLetter, rec1Guide, rentHistoryEmail, type TenantInfo } from "../lib/documents";
import { autocompleteAddress, searchAddress, lookupBuilding, type AddressMatch, type BuildingReport } from "../lib/nyc";

type Step = "address" | "building" | "questions" | "result";

const EMPTY_ANSWERS: TenantAnswers = {
  leaseHasRider: "unsure",
  moveInDate: null,
  currentRent: null,
  lastRegisteredRent: null,
  lastRegisteredYear: null,
  rentHistory: "not_requested",
  coopOrCondoUnit: "unsure",
  gutRenovationKnown: "unsure",
  unitsOverride: null,
};

export default function App() {
  const [step, setStep] = useState<Step>("address");
  const [report, setReport] = useState<BuildingReport | null>(null);
  const [facts, setFacts] = useState<BuildingFacts | null>(null);
  const [answers, setAnswers] = useState<TenantAnswers>(EMPTY_ANSWERS);

  const verdict = useMemo(() => (facts ? evaluate(facts, answers) : null), [facts, answers]);

  return (
    <main className="wrap">
      <header className="masthead">
        <p className="eyebrow">NYC tenants · free · nothing is saved</p>
        <h1>Is my apartment rent stabilized?</h1>
        <p className="lede">
          Start typing your address. We'll read the public record, ask you a few things only you know, and explain what it
          adds up to — then draft the letters to find out for sure.
        </p>
        <Disclaimer />
      </header>

      <Progress step={step} />

      {step === "address" && (
        <AddressStep
          onLoaded={(r) => {
            setReport(r);
            setFacts(r.facts);
            setStep("building");
          }}
        />
      )}

      {step === "building" && report && facts && (
        <BuildingStep
          report={report}
          facts={facts}
          setFacts={setFacts}
          onBack={() => setStep("address")}
          onNext={() => setStep("questions")}
        />
      )}

      {step === "questions" && (
        <QuestionsStep
          answers={answers}
          setAnswers={setAnswers}
          onBack={() => setStep("building")}
          onNext={() => setStep("result")}
        />
      )}

      {step === "result" && verdict && report && (
        <ResultStep verdict={verdict} report={report} answers={answers} onBack={() => setStep("questions")} />
      )}

      <footer className="foot">
        <p>
          Built from NYC Open Data and NYS DHCR public guidance. This tool is informational and is not legal advice.
          Rules engine is open source — see how every conclusion is reached.
        </p>
      </footer>
    </main>
  );
}

/* ---------------- Steps ---------------- */

function AddressStep({ onLoaded }: { onLoaded: (r: BuildingReport) => void }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [suggest, setSuggest] = useState<AddressMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const picked = useRef(false);

  // Suggestions as you type: wait for a short pause, cancel stale requests.
  useEffect(() => {
    if (picked.current) { picked.current = false; return; }
    if (q.trim().length < 3) { setSuggest([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const s = await autocompleteAddress(q.trim(), ctl.signal);
      if (!ctl.signal.aborted) { setSuggest(s); setOpen(true); setActive(-1); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  function choose(m: AddressMatch) {
    picked.current = true;
    setQ(m.label);
    setOpen(false);
    pick(m);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || !suggest.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggest.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(suggest[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    setBusy(true);
    setErr(null);
    try {
      setMatches(await searchAddress(q));
    } catch {
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  async function pick(m: AddressMatch) {
    setBusy(true);
    try {
      onLoaded(await lookupBuilding(m));
    } catch {
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>1 · Your building</h2>
      <form onSubmit={search} className="row">
        <div className="combo">
          <input
            aria-label="Street address"
            role="combobox"
            aria-expanded={open && suggest.length > 0}
            aria-controls="addr-suggest"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Start typing your address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => suggest.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && suggest.length > 0 && (
            <ul className="suggest" id="addr-suggest" role="listbox">
              {suggest.map((m, i) => (
                <li
                  key={m.bbl + m.label}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "on" : ""}
                  onMouseDown={(e) => { e.preventDefault(); choose(m); }}
                >
                  {m.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button disabled={busy || q.length < 4}>{busy ? "Looking…" : "Look it up"}</button>
      </form>
      <p className="hint">We only use the building address — not your apartment number — to look up public records.</p>
      {err && <p className="error">{err}</p>}
      {manual && <ManualBuilding address={q} onLoaded={onLoaded} />}
      {matches && matches.length === 0 && <p className="hint">No matches. Try adding the borough or ZIP code.</p>}
      {matches && matches.length > 0 && (
        <>
          <p className="hint">
            Pick your building. Streets can have more than one name (or spelling) — the tax lot number is what matters.
          </p>
          <ul className="matches">
            {matches.map((m) => (
              <li key={m.bbl + m.label}>
                <button className="ghost" onClick={() => pick(m)} disabled={busy}>
                  <span>{m.label}</span>
                  <small>Tax lot {formatBbl(m.bbl)}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BuildingStep({
  report,
  facts,
  setFacts,
  onBack,
  onNext,
}: {
  report: BuildingReport;
  facts: BuildingFacts;
  setFacts: (f: BuildingFacts) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const qualifies = facts.yearBuilt && facts.residentialUnits != null
    ? facts.yearBuilt < 1974 && facts.residentialUnits >= 6
    : null;

  return (
    <section className="card">
      <h2>2 · What the public record says</h2>
      <p className="hint">{report.match.label}</p>
      <dl className="facts">
        <Fact label="Year built" value={facts.yearBuilt ?? "Unknown"} />
        <Fact label="Residential units" value={facts.residentialUnits ?? "Unknown"} />
        <Fact label="Building class" value={facts.buildingClass ?? "Unknown"} />
        <Fact label="J-51 tax benefit (through 2019)" value={tri(facts.j51)} />
        <Fact label="Registered with HPD" value={tri(facts.hpdRegistered)} />
        <Fact label="Open HPD violations" value={report.openViolations ?? "Unknown"} />
        <Fact label="Owner of record" value={report.ownerName ?? "Unknown"} />
      </dl>

      {qualifies === true && (
        <div className="callout good">
          <strong>First read: the building qualifies by age and size.</strong> Built before 1974 with 6+ apartments —
          that makes it presumptively covered by rent stabilization. Next we check whether your unit could have left.
        </div>
      )}
      {qualifies === false && (
        <div className="callout">
          <strong>The building doesn't qualify by age and size alone.</strong> Units can still be stabilized through a
          tax benefit or other routes — keep going.
        </div>
      )}

      <details className="fix">
        <summary>Something look wrong? Correct it</summary>
        <div className="grid2">
          <label>
            Year built
            <input
              type="number"
              value={facts.yearBuilt ?? ""}
              onChange={(e) => setFacts({ ...facts, yearBuilt: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label>
            Number of apartments
            <input
              type="number"
              value={facts.residentialUnits ?? ""}
              onChange={(e) =>
                setFacts({ ...facts, residentialUnits: e.target.value ? Number(e.target.value) : null })
              }
            />
          </label>
        </div>
      </details>

      <Sources sources={report.sources} />
      <Nav onBack={onBack} onNext={onNext} nextLabel="Answer a few questions" />
    </section>
  );
}

function QuestionsStep({
  answers,
  setAnswers,
  onBack,
  onNext,
}: {
  answers: TenantAnswers;
  setAnswers: (a: TenantAnswers) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = <K extends keyof TenantAnswers>(k: K, v: TenantAnswers[K]) => setAnswers({ ...answers, [k]: v });
  const num = (v: string) => (v === "" ? null : Number(v));
  const hasHistory = answers.rentHistory !== "not_requested";

  return (
    <section className="card">
      <h2>3 · Things only you know</h2>
      <p className="hint">"Not sure" is always a fine answer. Nothing you type here leaves your browser.</p>

      <TriQ
        label="Did your lease come with a rent-stabilization rider?"
        help="A multi-page attachment titled something like 'Rent Stabilization Lease Rider.'"
        value={answers.leaseHasRider}
        onChange={(v) => set("leaseHasRider", v)}
      />

      <div className="grid2">
        <label>
          When did you move in?
          <input type="date" value={answers.moveInDate ?? ""} onChange={(e) => set("moveInDate", e.target.value || null)} />
        </label>
        <label>
          Current monthly rent ($)
          <input type="number" value={answers.currentRent ?? ""} onChange={(e) => set("currentRent", num(e.target.value))} />
        </label>
      </div>

      <label className="block">
        Have you gotten your official rent history from the state (DHCR)?
        <select value={answers.rentHistory} onChange={(e) => set("rentHistory", e.target.value as any)}>
          <option value="not_requested">Not yet — I'll request it (we'll draft it for you)</option>
          <option value="registered_rs">Yes — recent years show the unit as stabilized ("RS")</option>
          <option value="reg_not_found">Yes — recent years say "REG NOT FOUND"</option>
          <option value="exempt_with_reason">Yes — it lists the unit as exempt / permanently exempt</option>
          <option value="never_registered">Yes — the unit was never registered</option>
        </select>
      </label>

      {hasHistory && (
        <div className="grid2">
          <label>
            Last stabilized rent on the history ($)
            <input
              type="number"
              value={answers.lastRegisteredRent ?? ""}
              onChange={(e) => set("lastRegisteredRent", num(e.target.value))}
            />
          </label>
          <label>
            Year of that registration
            <input
              type="number"
              value={answers.lastRegisteredYear ?? ""}
              onChange={(e) => set("lastRegisteredYear", num(e.target.value))}
            />
          </label>
        </div>
      )}

      <TriQ
        label="Is your apartment owned as a co-op or condo unit?"
        value={answers.coopOrCondoUnit}
        onChange={(v) => set("coopOrCondoUnit", v)}
      />
      <TriQ
        label="Do you know of the whole building being gutted and rebuilt?"
        help="Not just your apartment being renovated — the entire building's systems replaced."
        value={answers.gutRenovationKnown}
        onChange={(v) => set("gutRenovationKnown", v)}
      />

      <Nav onBack={onBack} onNext={onNext} nextLabel="See what it adds up to" />
    </section>
  );
}

function ResultStep({
  verdict,
  report,
  answers,
  onBack,
}: {
  verdict: Verdict;
  report: BuildingReport;
  answers: TenantAnswers;
  onBack: () => void;
}) {
  const [ai, setAi] = useState<string | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "none">("idle");

  async function explain() {
    setAiState("loading");
    try {
      const sample = await (window as any).claude?.use?.("sample");
      if (!sample) return setAiState("none");
      const res = await sample(`${EXPLAIN_RULES}\n\nVerdict JSON:\n${JSON.stringify(verdict)}`, {
        modelTier: "default",
        onText: ({ text }: { text: string }) => setAi(text),
      });
      setAi(res.text);
      setAiState("idle");
    } catch {
      setAiState("none");
    }
  }

  return (
    <>
      <section className={`card verdict band-${verdict.band}`}>
        <h2>4 · What it adds up to</h2>
        <p className="headline">{verdict.headline}</p>
        <Meter verdict={verdict} />
        <p className="hint">
          Signal strength {verdict.range[0]}–{verdict.range[1]} out of 100. This measures how strongly the public
          record points one way — it is not a legal determination.
        </p>

        {!(window as any).claude ? null : ai ? (
          <div className="ai">{ai}</div>
        ) : (
          <button className="ghost" onClick={explain} disabled={aiState === "loading"}>
            {aiState === "loading" ? "Writing…" : aiState === "none" ? "Plain-English summary unavailable" : "Explain this in plain English"}
          </button>
        )}

        <h3>Why</h3>
        <ul className="reasons">
          {verdict.reasons.map((r) => (
            <li key={r.id} className={`dir-${r.direction}`}>
              <strong>{r.title}</strong>
              <p>{r.detail}</p>
            </li>
          ))}
        </ul>

        {verdict.exits.length > 0 && (
          <>
            <h3>Ways a unit can leave stabilization — checked</h3>
            <ul className="exits">
              {verdict.exits.map((x) => (
                <li key={x.exit}>
                  <span className={`pill ${x.status}`}>{label(x.status)}</span>
                  <div>
                    <strong>{x.exit}</strong>
                    <p>{x.explanation}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {verdict.unknowns.length > 0 && (
          <>
            <h3>What we can't see yet</h3>
            <ul className="unknowns">
              {verdict.unknowns.map((u) => (
                <li key={u.id}>
                  <strong>{u.question}</strong>
                  <p>{u.whyItMatters}</p>
                  <p className="how">→ {u.howToResolve}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="callout">
          <strong>Keep paying your rent on time.</strong> Whatever this shows, withholding rent can put you at risk of
          eviction. Overcharges are recovered through DHCR or a court, not by paying less on your own.
        </div>
        <Nav onBack={onBack} />
      </section>

      <ActionKit report={report} answers={answers} />
      <Resources />
    </>
  );
}

function ActionKit({ report, answers }: { report: BuildingReport; answers: TenantAnswers }) {
  const [t, setT] = useState<TenantInfo>({
    fullName: "",
    address: report.address ?? report.match.label.split(",")[0] ?? "",
    apt: "",
    borough: report.match.borough,
    zip: "",
    email: "",
    phone: "",
    ownerName: report.ownerName ?? "",
    moveInDate: answers.moveInDate ?? "",
    currentRent: answers.currentRent?.toString() ?? "",
  });
  const f = (k: keyof TenantInfo) => ({
    value: t[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: e.target.value }),
  });
  const email = rentHistoryEmail(t);

  return (
    <section className="card">
      <h2>5 · Your action kit</h2>
      <p className="hint">
        Fill in what you're comfortable with — it only goes into the documents below, in your browser. Nothing is sent
        or saved.
      </p>
      <div className="grid2">
        <label>Full name<input {...f("fullName")} /></label>
        <label>Apartment<input {...f("apt")} /></label>
        <label>Street address<input {...f("address")} /></label>
        <label>ZIP<input {...f("zip")} /></label>
        <label>Email<input {...f("email")} /></label>
        <label>Phone<input {...f("phone")} /></label>
        <label>Landlord (as on your lease)<input {...f("ownerName")} /></label>
        <label>Borough<input {...f("borough")} /></label>
      </div>
      <p className="hint">
        The owner of record from city data is prefilled, but use the name on your lease or rent bill if it's different.
      </p>

      <Doc
        title="1. Rent-history request (email)"
        when={`Send this first, to ${email.to}. It's free and usually takes a few weeks.`}
        text={`To: ${email.to}\nSubject: ${email.subject}\n\n${email.body}`}
        filename="rent-history-request.txt"
        mailto={`mailto:${email.to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
      />
      <Doc
        title="2. REC-1 form — fill-in guide"
        when="The formal version of the same request, if you'd rather use the state's form."
        text={rec1Guide(t)}
        filename="rec-1-guide.txt"
      />
      <Doc
        title="3. Request for a status determination"
        when="Once you have your rent history — or if the landlord won't answer — this asks DHCR to rule on your unit."
        text={determinationLetter(t)}
        filename="determination-request.txt"
      />
    </section>
  );
}

function Resources() {
  return (
    <section className="card">
      <h2>6 · Free and low-cost help</h2>
      <p className="hint">A tenant lawyer can review your situation, often for free. Bring your lease and rent history.</p>
      <ul className="resources">
        <li><a href="https://www.nyc.gov/site/mopt/index.page" target="_blank" rel="noreferrer">NYC Tenant Support (Mayor's Office to Protect Tenants)</a> — connects tenants to free legal help citywide.</li>
        <li><a href="https://www.metcouncilonhousing.org" target="_blank" rel="noreferrer">Met Council on Housing</a> — tenant hotline and organizing support.</li>
        <li><a href="https://www.legalservicesnyc.org" target="_blank" rel="noreferrer">Legal Services NYC</a> — free legal representation for eligible tenants.</li>
        <li><a href="https://housingcourtanswers.org" target="_blank" rel="noreferrer">Housing Court Answers</a> — plain-language help with housing court and rent questions.</li>
        <li><a href="https://www.justfix.org" target="_blank" rel="noreferrer">JustFix</a> — free tools for repair letters and building ownership lookups.</li>
      </ul>
    </section>
  );
}

/* ---------------- Small components ---------------- */

function Disclaimer() {
  return (
    <p className="disclaimer">
      <strong>Not legal advice.</strong> This tool reads public records and explains what they suggest. Only the state
      housing agency (DHCR) or a court can decide your apartment's status.
    </p>
  );
}

function Progress({ step }: { step: Step }) {
  const steps: Step[] = ["address", "building", "questions", "result"];
  const names = ["Address", "Building", "Your answers", "Result"];
  const i = steps.indexOf(step);
  return (
    <ol className="progress">
      {names.map((n, k) => (
        <li key={n} className={k < i ? "done" : k === i ? "now" : ""}>{n}</li>
      ))}
    </ol>
  );
}

function Meter({ verdict }: { verdict: Verdict }) {
  const [lo, hi] = verdict.range;
  return (
    <div className="meter" role="img" aria-label={`Signal range ${lo} to ${hi} out of 100`}>
      <div className="meter-range" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      <div className="meter-labels">
        <span>Unlikely</span><span>Weak</span><span>Moderate</span><span>Strong</span>
      </div>
    </div>
  );
}

function Doc({ title, when, text, filename, mailto }: { title: string; when: string; text: string; filename: string; mailto?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="doc">
      <summary>
        <strong>{title}</strong>
        <span>{when}</span>
      </summary>
      <pre>{text}</pre>
      <div className="row">
        <button
          className="ghost"
          onClick={async () => {
            try { await navigator.clipboard.writeText(text); } catch { return; }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {mailto && <a className="btn ghost" href={mailto}>Open in email</a>}
      </div>
    </details>
  );
}

function TriQ({ label: l, help, value, onChange }: { label: string; help?: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <fieldset className="tri">
      <legend>{l}</legend>
      {help && <p className="hint">{help}</p>}
      {(["yes", "no", "unsure"] as Tri[]).map((v) => (
        <label key={v} className={value === v ? "on" : ""}>
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          {v === "unsure" ? "Not sure" : v[0].toUpperCase() + v.slice(1)}
        </label>
      ))}
    </fieldset>
  );
}

function Fact({ label: l, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{l}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Sources({ sources }: { sources: BuildingReport["sources"] }) {
  return (
    <p className="sources">
      Sources:{" "}
      {sources.map((s, i) => (
        <span key={s.name}>
          <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
          {!s.ok && " (unavailable)"}
          {i < sources.length - 1 ? " · " : ""}
        </span>
      ))}
    </p>
  );
}

function Nav({ onBack, onNext, nextLabel }: { onBack?: () => void; onNext?: () => void; nextLabel?: string }) {
  return (
    <div className="nav">
      {onBack && <button className="ghost" onClick={onBack}>← Back</button>}
      {onNext && <button onClick={onNext}>{nextLabel ?? "Next"} →</button>}
    </div>
  );
}

const tri = (b: boolean | null) => (b === null ? "Couldn't check" : b ? "Yes" : "No");
const label = (s: string) =>
  ({ ruled_out: "Ruled out", unlikely: "Unlikely", possible: "Possible", unknown: "Unknown" })[s] ?? s;
const formatBbl = (b: string) => `${b[0]}-${b.slice(1, 6)}-${b.slice(6)}`;

const EXPLAIN_RULES = `You explain rent-stabilization screening results to NYC tenants who may be anxious.
You receive a JSON verdict produced by a deterministic rules engine.
Rules:
- Do not change the verdict band, add reasons, or invent facts. Explain only what's in the JSON.
- Never say the apartment IS or IS NOT stabilized. Say what the public record suggests.
- Never advise withholding rent. Paying rent on time protects the tenant while this gets resolved.
- Name the single biggest open question and how to resolve it.
- Plain, calm, 2nd person. 150-220 words. No headings, no bullet lists, no markdown.
- End with one sentence noting this is not legal advice and a tenant lawyer or tenant organization can review it free or at low cost.`;

function ManualBuilding({ address, onLoaded }: { address: string; onLoaded: (r: BuildingReport) => void }) {
  const [year, setYear] = useState("");
  const [units, setUnits] = useState("");
  const [owner, setOwner] = useState("");
  const [borough, setBorough] = useState("");
  const ready = year.length === 4 && units !== "";
  return (
    <div className="callout">
      <strong>Enter two facts about your building.</strong> This version can't reach the city's databases directly, so
      look them up on NYC's free{" "}
      <a href="https://zola.planning.nyc.gov" target="_blank" rel="noreferrer">ZoLa map</a>: search your address, click
      the building, and read "Year Built" and "Residential Units."
      <div className="grid2">
        <label>Year built<input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 1928" /></label>
        <label>Residential units<input type="number" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. 12" /></label>
        <label>Borough<input value={borough} onChange={(e) => setBorough(e.target.value)} placeholder="e.g. Brooklyn" /></label>
        <label>Owner (optional — from ZoLa or your lease)<input value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
      </div>
      <button
        disabled={!ready}
        onClick={() =>
          onLoaded({
            match: { label: address, bbl: "", bin: null, borough },
            facts: { yearBuilt: Number(year), residentialUnits: Number(units), buildingClass: null, j51: null, hpdRegistered: null },
            ownerName: owner || null,
            address: address || null,
            openViolations: null,
            sources: [{ name: "ZoLa (NYC City Planning), entered by you", url: "https://zola.planning.nyc.gov", ok: true }],
          })
        }
      >
        Continue →
      </button>
    </div>
  );
}
