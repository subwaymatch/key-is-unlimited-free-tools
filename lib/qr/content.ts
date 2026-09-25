/**
 * What the text in a QR code is: a link, Wi-Fi details, a contact card, a
 * phone number, an e-mail, a place, an event or a two-factor secret, each
 * spelled out, and links looked at for the tricks that make a scanned code
 * dangerous - a disguised host, a shortener hiding the destination, a raw
 * IP address.
 */

export type QrKind = "link" | "wifi" | "email" | "phone" | "sms" | "contact" | "location" | "event" | "otp" | "text";

export interface QrMeaning {
  kind: QrKind;
  /** "Link", "Wi-Fi network"... */
  label: string;
  /** "Label: value" lines. */
  facts: string[];
  warnings: string[];
}

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "rb.gy", "s.id", "qrco.de", "qr.codes", "lnkd.in", "t.ly", "bl.ink", "short.io"]);

/** Fields of a MECARD- or WIFI-style string: KEY:value; with backslash escapes. */
export function semicolonFields(body: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let key = "";
  let value = "";
  let inKey = true;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && index + 1 < body.length) {
      if (inKey) key += body[index + 1];
      else value += body[index + 1];
      index += 1;
    } else if (inKey && character === ":") {
      inKey = false;
    } else if (!inKey && character === ";") {
      const name = key.trim().toUpperCase();
      if (name) fields.set(name, [...(fields.get(name) ?? []), value]);
      key = "";
      value = "";
      inKey = true;
    } else if (inKey) key += character;
    else value += character;
  }
  if (!inKey && key.trim()) fields.set(key.trim().toUpperCase(), [...(fields.get(key.trim().toUpperCase()) ?? []), value]);
  return fields;
}

function linkWarnings(url: URL): string[] {
  const warnings: string[] = [];
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") warnings.push("The link is plain http, so the page is not encrypted on the way.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) warnings.push("The link goes to a bare IP address rather than a named site, which real businesses rarely print.");
  if (host.split(".").some((label) => label.startsWith("xn--"))) warnings.push("The site's name uses international characters that can imitate a familiar name letter for letter; read it carefully.");
  if (SHORTENERS.has(host.replace(/^www\./, ""))) warnings.push("The link goes through a shortener, which hides where it really leads until it is opened.");
  if (url.username || url.password) warnings.push("The link has a name before an @ sign, a classic way to make one site look like another. The site it opens is the part after the @.");
  if (/\.(apk|exe|msi|dmg|pkg|scr|bat|ipa)$/i.test(url.pathname)) warnings.push("The link downloads an app installer directly.");
  return warnings;
}

function vcardFields(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1).replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  return fields;
}

function icsDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]}${match[4] ? ` ${match[4]}:${match[5]}${match[7] ? " UTC" : ""}` : ""}`;
}

/** What a scanned text is and what it says. */
export function interpretQrText(text: string): QrMeaning {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper.startsWith("WIFI:")) {
    const fields = semicolonFields(trimmed.slice(5));
    const security = fields.get("T")?.[0] || "nopass";
    const facts = [`Network: ${fields.get("S")?.[0] ?? ""}`, `Security: ${security === "nopass" || security === "" ? "none (open network)" : security}`];
    if (fields.get("P")?.[0]) facts.push(`Password: ${fields.get("P")![0]}`);
    if (fields.get("H")?.[0]?.toLowerCase() === "true") facts.push("Hidden: yes, the network does not announce itself");
    return { kind: "wifi", label: "Wi-Fi network", facts, warnings: security === "nopass" ? ["An open network: anything sent over it without https can be read by others nearby."] : [] };
  }

  if (upper.startsWith("OTPAUTH://")) {
    try {
      const url = new URL(trimmed);
      const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const facts = [`Account: ${label}`, `Type: ${url.hostname.toUpperCase()}`];
      if (url.searchParams.get("issuer")) facts.push(`Issuer: ${url.searchParams.get("issuer")}`);
      facts.push(`Digits: ${url.searchParams.get("digits") ?? "6"}, every ${url.searchParams.get("period") ?? "30"} seconds`);
      return { kind: "otp", label: "Two-factor secret", facts, warnings: ["This code holds the secret behind a two-factor login. Anyone who scans it can make the same six-digit codes; keep it and this picture private."] };
    } catch {
      // Fall through to plain text.
    }
  }

  if (/^(https?|ftp):\/\//i.test(trimmed) || /^www\.[^\s]+\.[a-z]{2,}/i.test(trimmed)) {
    try {
      const url = new URL(/^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed);
      return { kind: "link", label: "Link", facts: [`Opens: ${url.hostname}`, `Address: ${url.href}`], warnings: linkWarnings(url) };
    } catch {
      // Fall through.
    }
  }

  if (/^mailto:/i.test(trimmed)) {
    const [address, query = ""] = trimmed.slice(7).split("?");
    const params = new URLSearchParams(query);
    const facts = [`To: ${decodeURIComponent(address)}`];
    if (params.get("subject")) facts.push(`Subject: ${params.get("subject")}`);
    if (params.get("body")) facts.push(`Message: ${params.get("body")}`);
    return { kind: "email", label: "E-mail", facts, warnings: [] };
  }
  if (upper.startsWith("MATMSG:")) {
    const fields = semicolonFields(trimmed.slice(7));
    return { kind: "email", label: "E-mail", facts: [`To: ${fields.get("TO")?.[0] ?? ""}`, `Subject: ${fields.get("SUB")?.[0] ?? ""}`, `Message: ${fields.get("BODY")?.[0] ?? ""}`].filter((fact) => !fact.endsWith(": ")), warnings: [] };
  }

  if (/^tel:/i.test(trimmed)) return { kind: "phone", label: "Phone number", facts: [`Number: ${trimmed.slice(4)}`], warnings: [] };
  if (/^(sms|smsto):/i.test(trimmed)) {
    const rest = trimmed.replace(/^(sms|smsto):/i, "");
    const [number, message] = rest.includes("?body=") ? rest.split("?body=") : rest.split(":");
    const facts = [`Number: ${number}`];
    if (message) facts.push(`Message: ${decodeURIComponent(message)}`);
    return { kind: "sms", label: "Text message", facts, warnings: [] };
  }

  if (/^geo:/i.test(trimmed)) {
    const [lat, lon] = trimmed.slice(4).split(/[,;?]/);
    return { kind: "location", label: "Place", facts: [`Latitude: ${lat}`, `Longitude: ${lon}`], warnings: [] };
  }

  if (upper.startsWith("BEGIN:VCARD")) {
    const fields = vcardFields(trimmed);
    const facts: string[] = [];
    const name = fields.get("FN")?.[0] ?? fields.get("N")?.[0]?.split(";").filter(Boolean).reverse().join(" ");
    if (name) facts.push(`Name: ${name}`);
    for (const org of fields.get("ORG") ?? []) facts.push(`Organisation: ${org.replace(/;/g, ", ")}`);
    for (const phone of fields.get("TEL") ?? []) facts.push(`Phone: ${phone}`);
    for (const email of fields.get("EMAIL") ?? []) facts.push(`Email: ${email}`);
    for (const url of fields.get("URL") ?? []) facts.push(`Website: ${url}`);
    for (const adr of fields.get("ADR") ?? []) facts.push(`Address: ${adr.split(";").filter(Boolean).join(", ")}`);
    return { kind: "contact", label: "Contact card", facts, warnings: [] };
  }
  if (upper.startsWith("MECARD:")) {
    const fields = semicolonFields(trimmed.slice(7));
    const facts: string[] = [];
    if (fields.get("N")) facts.push(`Name: ${fields.get("N")![0].split(",").reverse().join(" ").trim()}`);
    for (const phone of fields.get("TEL") ?? []) facts.push(`Phone: ${phone}`);
    for (const email of fields.get("EMAIL") ?? []) facts.push(`Email: ${email}`);
    for (const url of fields.get("URL") ?? []) facts.push(`Website: ${url}`);
    for (const adr of fields.get("ADR") ?? []) facts.push(`Address: ${adr}`);
    return { kind: "contact", label: "Contact card", facts, warnings: [] };
  }

  if (upper.startsWith("BEGIN:VEVENT") || upper.startsWith("BEGIN:VCALENDAR")) {
    const fields = vcardFields(trimmed);
    const facts: string[] = [];
    if (fields.get("SUMMARY")) facts.push(`Event: ${fields.get("SUMMARY")![0]}`);
    if (fields.get("DTSTART")) facts.push(`Starts: ${icsDate(fields.get("DTSTART")![0])}`);
    if (fields.get("DTEND")) facts.push(`Ends: ${icsDate(fields.get("DTEND")![0])}`);
    if (fields.get("LOCATION")) facts.push(`Where: ${fields.get("LOCATION")![0]}`);
    return { kind: "event", label: "Calendar event", facts, warnings: [] };
  }

  return { kind: "text", label: "Text", facts: [], warnings: [] };
}
