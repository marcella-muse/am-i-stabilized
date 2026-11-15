/**
 * Generates the three documents a tenant needs to start:
 *   1. Rent-history request email to DHCR
 *   2. REC-1 ("Request for Records Access") fill-in guide
 *   3. Request for an administrative determination of stabilization status
 *
 * Plain text so tenants can paste into email or print. Everything is generated
 * in the browser from what the tenant typed — nothing is stored.
 */

export interface TenantInfo {
  fullName: string;
  address: string; // street address of the apartment
  apt: string;
  borough: string;
  zip: string;
  email: string;
  phone: string;
  ownerName: string; // landlord of record, prefilled from PLUTO, editable
  moveInDate: string;
  currentRent: string;
}

// VERIFY these against https://hcr.ny.gov/records-access before launch.
export const DHCR = {
  recordsEmail: "rentinfo@hcr.ny.gov",
  mailingAddress: [
    "NYS Homes and Community Renewal",
    "Office of Rent Administration — Records Access Officer",
    "Gertz Plaza, 92-31 Union Hall Street",
    "Jamaica, NY 11433",
  ],
  rec1Url: "https://hcr.ny.gov/records-access",
};

const today = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const or = (v: string, placeholder: string) => (v && v.trim() ? v.trim() : `[${placeholder}]`);

export function rentHistoryEmail(t: TenantInfo) {
  const subject = `Rent history request — ${or(t.address, "address")}, Apt ${or(t.apt, "apt")}, ${or(t.borough, "borough")}`;
  const body = `To the Records Access Officer,

I am the tenant of record at ${or(t.address, "address")}, Apartment ${or(t.apt, "apt")}, ${or(t.borough, "borough")}, NY ${or(t.zip, "ZIP")}. I am requesting a copy of the complete rent registration history for my apartment, from the earliest available year to the present.

Please send the records to the address above or to this email address.

Attached is proof of my tenancy (a copy of my current lease and a recent rent receipt or bill) and a copy of my photo ID.

Thank you,
${or(t.fullName, "your full name")}
${or(t.phone, "phone")}
${or(t.email, "email")}
`;
  return { to: DHCR.recordsEmail, subject, body };
}

export function rec1Guide(t: TenantInfo) {
  return `REC-1 "REQUEST FOR RECORDS ACCESS" — FILL-IN GUIDE
Download the form at ${DHCR.rec1Url}. Copy these answers onto it.

SECTION 1 — Requester
  Name:          ${or(t.fullName, "your full name")}
  Address:       ${or(t.address, "address")}, Apt ${or(t.apt, "apt")}, ${or(t.borough, "borough")}, NY ${or(t.zip, "ZIP")}
  Phone / email: ${or(t.phone, "phone")} / ${or(t.email, "email")}

SECTION 2 — Building / apartment the records are about
  Address:       ${or(t.address, "address")}
  Apartment:     ${or(t.apt, "apt")}
  Owner:         ${or(t.ownerName, "landlord name from your lease")}

SECTION 3 — Your relationship to the records
  Current tenant of the apartment.

SECTIONS 4–8 — Choose ONE category only
  Choose the category for an individual apartment's rent history and ask for
  the complete registration history for Apt ${or(t.apt, "apt")}, all available years.
  (Asking for any deregulation/exemption filings on the unit is also worth writing in.)

SIGN AND DATE the form.

ATTACH: copy of your lease + proof you live there (rent receipt, utility bill) + photo ID.
  Missing proof is the most common reason requests are rejected.

SEND by email to ${DHCR.recordsEmail} or by mail to:
  ${DHCR.mailingAddress.join("\n  ")}

Keep a copy of everything you send and note the date.
`;
}

export function determinationLetter(t: TenantInfo) {
  return `${or(t.fullName, "Your full name")}
${or(t.address, "address")}, Apt ${or(t.apt, "apt")}
${or(t.borough, "borough")}, NY ${or(t.zip, "ZIP")}
${or(t.email, "email")} · ${or(t.phone, "phone")}

${today()}

${DHCR.mailingAddress.slice(0, 1).join("\n")}
Office of Rent Administration
${DHCR.mailingAddress.slice(2).join("\n")}

Re: Request for determination of rent-stabilization status
    ${or(t.address, "address")}, Apartment ${or(t.apt, "apt")}, ${or(t.borough, "borough")}
    Owner: ${or(t.ownerName, "landlord name")}

To whom it may concern:

I am the tenant of the apartment above and have lived there since ${or(t.moveInDate, "move-in date")}. I respectfully request that DHCR determine whether my apartment is subject to the Rent Stabilization Law and Code.

The building appears to have been built before 1974 and to contain six or more residential units. [Edit if your basis is different, e.g. a J-51 or 421-a tax benefit.] My current rent is $${or(t.currentRent, "current rent")} per month and my lease [does / does not] include a rent-stabilization rider.

[Optional — if you have your rent history:] DHCR's registration records for the apartment show [describe, e.g. "a last registered stabilized rent of $___ in ___, followed by 'REG NOT FOUND' for later years, with no registered reason for exemption"].

I am not aware of any order or filing establishing that the apartment lawfully left rent stabilization. I ask that DHCR determine the apartment's regulatory status and, if it is stabilized, its legal regulated rent.

Enclosed: copy of my current lease, proof of tenancy, and [rent history, if available].

Thank you for your attention.

Sincerely,

${or(t.fullName, "Your full name")}

---
Not legal advice. Consider having a tenant lawyer or tenant organization review
this before sending. Keep copies of everything and send it in a trackable way.
`;
}
