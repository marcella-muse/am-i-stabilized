# Is my apartment rent stabilized?

A free, stateless, guided check for NYC tenants: address → public-record building facts →
a few questions only the tenant knows → an explained confidence read → pre-filled letters
to find out for sure. **Not legal advice.** No login, no database, nothing stored.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for the plain-English summary
npm run dev                  # http://localhost:3000
npm test                     # rules-engine tests
```

Deploy: push to GitHub → import in Vercel → add the env vars → done.

## How it's built

| Piece | File | Notes |
|---|---|---|
| Rules engine | `lib/engine.ts` | Deterministic TypeScript. Every score change is a `Reason` the UI shows. This is the core — open-source it. |
| NYC data | `lib/nyc.ts` | GeoSearch (address → BBL), PLUTO, HPD registrations, HPD violations, J-51 (historical). Failures become "unknown", never "no". |
| Documents | `lib/documents.ts` | Rent-history email, REC-1 fill-in guide, determination-request letter. Generated in the browser. |
| LLM layer | `app/api/explain/route.ts` | Optional. Rewrites the engine's verdict in plain English. Cannot change the verdict. Sends no personal info. |
| Wizard | `app/page.tsx` | One page, five steps, client-side state only. |

## Things to verify before showing real tenants

1. **Run your own building through it first.** I couldn't reach the NYC APIs from where this was built,
   so the live lookups are written to the documented endpoints but untested. Expect to fix a field name or two.
2. **J-51 query** (`lib/nyc.ts → j51Where`): open the dataset page, confirm the borough/block/lot field
   names, adjust. Until then it fails safe to "Couldn't check."
3. **Deregulation thresholds** (`lib/engine.ts → DEREG_THRESHOLDS`): the 2015–2019 figure was indexed
   annually; $2,700 is a simplification. Have a tenant lawyer sanity-check the table.
4. **DHCR contact details** (`lib/documents.ts → DHCR`): confirm the records email and mailing address on
   hcr.ny.gov/records-access.
5. **Engine weights**: they're hand-tuned to produce sensible bands, not calibrated. Say so publicly.
6. **Get a lawyer to read the result copy and the determination letter** before wide release.

## Weekend plan

**Friday night (done-ish):** scaffold, engine, tests. → `npm run dev`, click through with your address.

**Saturday**
- Morning: fix whatever the live APIs break. Handle streets with more than one name or spelling in the address picker if needed.
- Afternoon: run 5–10 known buildings (your own, friends', one obvious new-construction, one 4-unit brownstone)
  and add each as a fixture in `tests/`. Wherever the band feels wrong, change a weight and add a test.
- Evening: deploy to Vercel. Add your API key; read 3–4 generated explanations critically.

**Sunday**
- Morning: polish copy. Read every screen as a scared tenant would. Cut jargon.
- Afternoon: send to 3–5 people — ideally one tenant organizer and one tenant lawyer — for a gut-check.
- Stretch: add 421-a via DOF Property Exemption Detail (`muvi-b6kx`); add the registered-buildings
  list via nycdb's `rentstab` data.

**v2 (later):** overcharge calculator (needs a verified table of RGB one-year increases), upload-and-interpret
your rent history, real REC-1 PDF fill. **v3:** organizing layer — design the privacy model first.

## License

MIT — see `LICENSE`. The software license does not make anything here legal advice.
