// scripts/scanTest/parse.js
// Turns what the phone read into license fields.
//   parseFront(text)  — text from OCR of the FRONT of a license (Florida first)
//   parseAamva(text)  — data from the PDF417 barcode on the BACK (AAMVA standard,
//                       used by every US state)
// Both return the same field names so the desktop can compare them side by side.
// Every field is a string or null (null = not found).

export const FIELD_ORDER = [
  ["lastName", "Last name"],
  ["firstName", "First name"],
  ["middleName", "Middle name"],
  ["dlNumber", "DL number"],
  ["dob", "Date of birth"],
  ["issued", "Issued"],
  ["expires", "Expires"],
  ["street", "Street"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
  ["sex", "Sex"],
  ["height", "Height"],
  ["eyes", "Eyes"],
];

function emptyFields() {
  const f = {};
  for (const [k] of FIELD_ORDER) f[k] = null;
  return f;
}

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Florida DL numbers are 1 letter + 12 digits, printed X123-456-78-901-0.
// Barcodes usually carry them without dashes. Normalize both to the dashed form.
export function formatFlDl(raw) {
  const m = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^([A-Z])(\d{3})(\d{3})(\d{2})(\d{3})(\d)$/);
  return m ? `${m[1]}${m[2]}-${m[3]}-${m[4]}-${m[5]}-${m[6]}` : null;
}

// ─────────────────────────── Back: AAMVA barcode ───────────────────────────
// AAMVA element IDs we care about.
const AAMVA = {
  DCS: "lastName", DAC: "firstName", DAD: "middleName",
  DAQ: "dlNumber", DBB: "dob", DBA: "expires", DBD: "issued",
  DAG: "street", DAI: "city", DAJ: "state", DAK: "zip",
  DBC: "sex", DAU: "height", DAY: "eyes",
};

function aamvaDate(v, isCanada) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 8) return clean(v) || null;
  // US format is MMDDCCYY; Canada uses CCYYMMDD.
  if (isCanada || /^(19|20)\d{2}(0[1-9]|1[0-2])/.test(d) && !/^(0[1-9]|1[0-2])/.test(d)) {
    return `${d.slice(4, 6)}/${d.slice(6, 8)}/${d.slice(0, 4)}`;
  }
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
}

export function parseAamva(text) {
  const out = emptyFields();
  // Some readers spell control characters out as "<LF>", "<CR>", "<RS>"…
  const raw = String(text || "").replace(/<(LF|CR|RS|GS|FS|US)>/g, "\n");
  if (!raw) return { fields: out, elementsFound: 0, ok: false };
  const isCanada = /ANSI\s*\d{6}/.test(raw) && /\b(636012|636013|636014|636015|636016|636017|636018|636019|636020|636021|636022|636024|636025|636027|636028)\b/.test(raw);

  // Elements are separated by line breaks (LF/CR/RS). The first element of a
  // subfile is glued to its "DL"/"ID" marker (e.g. "DLDAQB123..."), so an
  // element may start after a separator OR right after DL/ID.
  let found = 0;
  for (const id of Object.keys(AAMVA)) {
    const m = raw.match(new RegExp("(?:^|[\\r\\n\\x1e]|DL|ID)" + id + "([^\\r\\n\\x1e]*)"));
    if (!m) continue;
    const val = clean(m[1]);
    if (!val || val === "NONE" || /^unavl$/i.test(val)) continue;
    found++;
    const key = AAMVA[id];
    if (key === "dob" || key === "expires" || key === "issued") out[key] = aamvaDate(val, isCanada);
    else if (key === "sex") out.sex = val === "1" ? "M" : val === "2" ? "F" : val;
    else if (key === "zip") out.zip = val.replace(/[^0-9-]/g, "").slice(0, 5) || null;
    else if (key === "height") {
      const inch = val.match(/^0*(\d{2,3})\s*IN/i);
      out.height = inch ? `${Math.floor(+inch[1] / 12)}'-${String(+inch[1] % 12).padStart(2, "0")}"` : val;
    } else out[key] = val.toUpperCase();
  }
  // Older cards put "LAST,FIRST,MIDDLE" in DAA.
  if (!out.lastName) {
    const daa = raw.match(/DAA([^\r\n]+)/);
    if (daa) {
      const parts = daa[1].split(/[,$]/).map(clean);
      out.lastName = parts[0] || null; out.firstName = parts[1] || null; out.middleName = parts[2] || null;
      found++;
    }
  }
  if (out.dlNumber) out.dlNumber = formatFlDl(out.dlNumber) || out.dlNumber.toUpperCase();
  return { fields: out, elementsFound: found, ok: found >= 3 };
}

// ─────────────────────────── Front: OCR text ───────────────────────────
// The front is read as plain text, so this is pattern matching. Florida cards
// use the standard AAMVA field numbers next to each label:
//   1 last name · 2 first/middle · 3 DOB · 4a ISS · 4b EXP · 4d DL number
//   8 address · 15 SEX · 16 HGT · 18 EYES
const DATE_RE = /(\d{2})\s*[\/\-.]\s*(\d{2})\s*[\/\-.]\s*(\d{4})/g;

function fixDigits(s) {
  // Common OCR mix-ups inside things that should be numbers.
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

function findDateNear(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    const here = [...lines[i].matchAll(DATE_RE)];
    // Date on the same line, after the label if possible.
    if (here.length) {
      const idx = lines[i].search(labelRe);
      const after = here.find((m) => m.index > idx) || here[0];
      return `${after[1]}/${after[2]}/${after[3]}`;
    }
    const next = lines[i + 1] && [...lines[i + 1].matchAll(DATE_RE)];
    if (next && next.length) return `${next[0][1]}/${next[0][2]}/${next[0][3]}`;
  }
  return null;
}

export function parseFront(text) {
  const out = emptyFields();
  const rawText = String(text || "");
  const lines = rawText.split(/\r?\n/).map((l) => l.replace(/[^\x20-\x7E]/g, "").trim()).filter(Boolean);
  const upper = lines.map((l) => l.toUpperCase());
  const joined = upper.join("\n");

  // DL number: letter + 12 digits, often with dashes or spaces.
  const dlRe = /\b([A-Z])\s?([0-9OIlSB]{3})[\s\-]?([0-9OIlSB]{3})[\s\-]?([0-9OIlSB]{2})[\s\-]?([0-9OIlSB]{3})[\s\-]?([0-9OIlSB])\b/;
  const dlM = joined.match(dlRe);
  if (dlM) out.dlNumber = formatFlDl(dlM[1] + fixDigits(dlM.slice(2).join("")));

  // Dates by label first, then by order (oldest = DOB, newest = EXP).
  out.dob = findDateNear(upper, /\bDOB\b|\b3\s*DOB/);
  out.issued = findDateNear(upper, /\bISS\b|\b4A\b/);
  out.expires = findDateNear(upper, /\bEXP\b|\b4B\b/);
  const allDates = [...joined.matchAll(DATE_RE)].map((m) => ({ s: `${m[1]}/${m[2]}/${m[3]}`, y: +m[3] }));
  if (allDates.length) {
    const sorted = [...allDates].sort((a, b) => a.y - b.y);
    if (!out.dob) out.dob = sorted[0].s;
    if (!out.expires && sorted.length > 1) out.expires = sorted[sorted.length - 1].s;
    if (!out.issued && sorted.length > 2) {
      const mid = sorted.find((d) => d.s !== out.dob && d.s !== out.expires);
      out.issued = mid ? mid.s : null;
    }
  }

  // Names: the line labeled "1" is the last name, "2" is first + middle.
  for (const l of upper) {
    const m1 = l.match(/^\s*1\s+([A-Z][A-Z' \-]{1,})$/);
    if (m1 && !out.lastName) out.lastName = clean(m1[1]);
    const m2 = l.match(/^\s*2\s+([A-Z][A-Z' \-]{1,})$/);
    if (m2 && !out.firstName) {
      const parts = clean(m2[1]).split(" ");
      out.firstName = parts[0] || null;
      out.middleName = parts.slice(1).join(" ") || null;
    }
  }

  // Address: "8 <street>" then a "CITY, FL 12345" line.
  for (let i = 0; i < upper.length; i++) {
    const st = upper[i].match(/^\s*8\s+(\d+.*)$/);
    if (st && !out.street) out.street = clean(st[1]);
    const cz = upper[i].match(/([A-Z][A-Z .'\-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
    if (cz && !out.city) {
      out.city = clean(cz[1]); out.state = cz[2]; out.zip = cz[3];
      if (!out.street && i > 0 && /^\d+\s/.test(upper[i - 1])) out.street = clean(upper[i - 1]);
    }
  }

  const sex = joined.match(/\bSEX\s*[:.]?\s*([MF])\b/) || joined.match(/\b15\s+(?:SEX\s+)?([MF])\b/);
  if (sex) out.sex = sex[1];
  const hgt = joined.match(/HGT\s*[:.]?\s*(\d)\s*(?:['’`]\s*-?|-)\s*(\d{1,2})/);
  if (hgt) out.height = `${hgt[1]}'-${hgt[2].padStart(2, "0")}"`;
  const eyes = joined.match(/\bEYES?\s*[:.]?\s*(BRO|BLU|GRN|HAZ|BLK|GRY|MAR|PNK|DIC)\b/);
  if (eyes) out.eyes = eyes[1];

  const filled = Object.values(out).filter(Boolean).length;
  return { fields: out, fieldsFound: filled, ok: filled >= 3 };
}
