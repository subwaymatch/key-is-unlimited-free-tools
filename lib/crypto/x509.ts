/**
 * X.509 certificates and certificate signing requests, read from PEM or
 * DER: who a certificate names and who vouched for it, when it runs out,
 * the names it covers, what it may be used for, and its fingerprints.
 *
 * A certificate is DER - ASN.1's binary encoding, a tree of type, length
 * and value - usually wrapped in the base64 of a PEM block. This reads the
 * tree by hand and walks the fields RFC 5280 defines, naming the object
 * identifiers a person would recognise. It checks nothing cryptographic:
 * the signature is described, not verified, and the page says so.
 */
import { createDigest } from "../hash/digest";

/* ---- DER ----------------------------------------------------------------- */

export interface Asn1 {
  /** The identifier byte: class, constructed bit and tag number. */
  tag: number;
  /** The whole element, header included, for fingerprints and re-encoding. */
  raw: Uint8Array;
  /** The value's bytes. */
  value: Uint8Array;
  children: Asn1[];
}

export class Asn1Error extends Error {}

function readLength(bytes: Uint8Array, at: number): { length: number; size: number } {
  const first = bytes[at];
  if (first === undefined) throw new Asn1Error("The data ends in the middle of an element.");
  if (first < 0x80) return { length: first, size: 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 4) throw new Asn1Error("An element's length is written in a form DER does not use.");
  let length = 0;
  for (let index = 1; index <= count; index += 1) length = length * 256 + bytes[at + index];
  return { length, size: 1 + count };
}

/** One element and, when it is constructed, everything inside it. */
export function readAsn1(bytes: Uint8Array, at = 0, depth = 0): Asn1 {
  if (depth > 40) throw new Asn1Error("The data nests deeper than any certificate does.");
  const tag = bytes[at];
  if (tag === undefined) throw new Asn1Error("The data ends where an element should start.");
  if ((tag & 0x1f) === 0x1f) throw new Asn1Error("An element uses a long-form tag, which certificates do not.");
  const { length, size } = readLength(bytes, at + 1);
  const start = at + 1 + size;
  const end = start + length;
  if (end > bytes.length) throw new Asn1Error("An element runs past the end of the data; the file is cut short.");
  const node: Asn1 = { tag, raw: bytes.subarray(at, end), value: bytes.subarray(start, end), children: [] };
  // Constructed elements, and the context-tagged wrappers that hold them, are parsed down.
  if (tag & 0x20) {
    for (let cursor = start; cursor < end; ) {
      const next = readAsn1(bytes, cursor, depth + 1);
      node.children.push(next);
      cursor += next.raw.length;
    }
  }
  return node;
}

export function oidOf(value: Uint8Array): string {
  const parts: number[] = [];
  let current = 0;
  for (const byte of value) {
    current = current * 128 + (byte & 0x7f);
    if (byte & 0x80) continue;
    if (parts.length === 0) {
      const first = current < 80 ? Math.floor(current / 40) : 2;
      parts.push(first, current - first * 40);
    } else parts.push(current);
    current = 0;
  }
  return parts.join(".");
}

function hex(bytes: Uint8Array, separator = ""): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(separator);
}

function stringOf(node: Asn1): string {
  switch (node.tag) {
    case 0x1e: {
      // BMPString: UTF-16 big-endian.
      let out = "";
      for (let index = 0; index + 1 < node.value.length; index += 2) out += String.fromCharCode((node.value[index] << 8) | node.value[index + 1]);
      return out;
    }
    case 0x0c:
      return new TextDecoder("utf-8").decode(node.value);
    default:
      return new TextDecoder("latin1").decode(node.value);
  }
}

/** UTCTime or GeneralizedTime as a Date. */
export function timeOf(node: Asn1): Date {
  const text = new TextDecoder("latin1").decode(node.value);
  const match = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text);
  if (!match) throw new Asn1Error(`A date is written in a form this does not read: ${text}.`);
  let year = Number(match[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
}

/* ---- Names for object identifiers ----------------------------------------- */

const ATTRIBUTES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "street",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.5": "serialNumber",
  "2.5.4.4": "SN",
  "2.5.4.42": "GN",
  "2.5.4.12": "title",
  "2.5.4.17": "postalCode",
  "2.5.4.15": "businessCategory",
  "1.2.840.113549.1.9.1": "emailAddress",
  "0.9.2342.19200300.100.1.25": "DC",
  "0.9.2342.19200300.100.1.1": "UID",
  "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC",
  "2.5.4.97": "organizationIdentifier",
};

const ALGORITHMS: Record<string, string> = {
  "1.2.840.113549.1.1.1": "RSA",
  "1.2.840.10045.2.1": "ECDSA",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
  "1.2.840.10040.4.1": "DSA",
  "1.2.840.113549.1.1.4": "MD5 with RSA",
  "1.2.840.113549.1.1.5": "SHA-1 with RSA",
  "1.2.840.113549.1.1.11": "SHA-256 with RSA",
  "1.2.840.113549.1.1.12": "SHA-384 with RSA",
  "1.2.840.113549.1.1.13": "SHA-512 with RSA",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.10045.4.1": "ECDSA with SHA-1",
  "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
};

const CURVES: Record<string, string> = {
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
  "1.3.132.0.35": "P-521",
  "1.3.132.0.10": "secp256k1",
};

const KEY_PURPOSES: Record<string, string> = {
  "1.3.6.1.5.5.7.3.1": "TLS server",
  "1.3.6.1.5.5.7.3.2": "TLS client",
  "1.3.6.1.5.5.7.3.3": "code signing",
  "1.3.6.1.5.5.7.3.4": "e-mail protection",
  "1.3.6.1.5.5.7.3.8": "time stamping",
  "1.3.6.1.5.5.7.3.9": "OCSP signing",
  "2.5.29.37.0": "any purpose",
  "1.3.6.1.4.1.311.10.3.12": "document signing",
};

const POLICIES: Record<string, string> = {
  "2.23.140.1.2.1": "domain validated",
  "2.23.140.1.2.2": "organisation validated",
  "2.23.140.1.2.3": "individual validated",
  "2.23.140.1.1": "extended validation",
  "2.5.29.32.0": "any policy",
};

const KEY_USAGES = ["digital signature", "non-repudiation", "key encipherment", "data encipherment", "key agreement", "certificate signing", "CRL signing", "encipher only", "decipher only"];

/* ---- Certificates -------------------------------------------------------- */

export interface Certificate {
  kind: "certificate" | "request";
  der: Uint8Array;
  version: number;
  serial: string;
  subject: string;
  /** The subject's common name, or the whole subject when it has none. */
  commonName: string;
  issuer: string;
  notBefore: Date | null;
  notAfter: Date | null;
  signature: string;
  key: string;
  altNames: string[];
  isCa: boolean | null;
  pathLength: number | null;
  keyUsage: string[];
  extendedKeyUsage: string[];
  policies: string[];
  ocsp: string[];
  issuerUrls: string[];
  crls: string[];
  subjectKeyId: string | null;
  authorityKeyId: string | null;
  sha256: string;
  sha1: string;
}

function nameOf(node: Asn1): { text: string; commonName: string | null } {
  const parts: string[] = [];
  let commonName: string | null = null;
  for (const set of node.children) {
    for (const pair of set.children) {
      const [type, value] = pair.children;
      if (!type || !value) continue;
      const oid = oidOf(type.value);
      const label = ATTRIBUTES[oid] ?? oid;
      const text = stringOf(value);
      if (label === "CN" && commonName === null) commonName = text;
      parts.push(`${label}=${/[,+"\\<>;]/.test(text) ? `"${text.replace(/(["\\])/g, "\\$1")}"` : text}`);
    }
  }
  return { text: parts.join(", "), commonName };
}

function keyOf(spki: Asn1): string {
  const [algorithm, bits] = spki.children;
  const oid = algorithm?.children[0] ? oidOf(algorithm.children[0].value) : "";
  const name = ALGORITHMS[oid] ?? oid;
  if (name === "RSA" && bits) {
    try {
      const key = readAsn1(bits.value.subarray(1));
      const modulus = key.children[0]?.value ?? new Uint8Array(0);
      let length = modulus.length;
      let at = 0;
      while (at < modulus.length && modulus[at] === 0) {
        at += 1;
        length -= 1;
      }
      const top = modulus[at] ?? 0;
      return `RSA ${(length - 1) * 8 + (top === 0 ? 0 : Math.floor(Math.log2(top)) + 1)}-bit`;
    } catch {
      return "RSA";
    }
  }
  if (name === "ECDSA") {
    const curve = algorithm?.children[1]?.tag === 0x06 ? oidOf(algorithm.children[1].value) : "";
    return `ECDSA ${CURVES[curve] ?? curve}`.trim();
  }
  return name;
}

/** The names a subjectAltName extension lists: DNS names, IP addresses, e-mail addresses and URIs. */
function altNamesOf(value: Asn1): string[] {
  const out: string[] = [];
  for (const name of value.children) {
    const kind = name.tag & 0x1f;
    if (kind === 2) out.push(`DNS:${new TextDecoder("latin1").decode(name.value)}`);
    else if (kind === 1) out.push(`email:${new TextDecoder("latin1").decode(name.value)}`);
    else if (kind === 6) out.push(`URI:${new TextDecoder("latin1").decode(name.value)}`);
    else if (kind === 7) {
      if (name.value.length === 4) out.push(`IP:${Array.from(name.value).join(".")}`);
      else if (name.value.length === 16) {
        const groups: string[] = [];
        for (let index = 0; index < 16; index += 2) groups.push(((name.value[index] << 8) | name.value[index + 1]).toString(16));
        out.push(`IP:${groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::")}`);
      }
    } else if (kind === 4 && name.children[0]) out.push(`DirName:${nameOf(name.children[0]).text}`);
  }
  return out;
}

function uriList(node: Asn1): string[] {
  const out: string[] = [];
  const walk = (entry: Asn1) => {
    if ((entry.tag & 0x1f) === 6 && (entry.tag & 0xc0) === 0x80 && !(entry.tag & 0x20)) out.push(new TextDecoder("latin1").decode(entry.value));
    for (const inner of entry.children) walk(inner);
  };
  walk(node);
  return out;
}

function applyExtensions(certificate: Certificate, extensions: Asn1[]): void {
  for (const extension of extensions) {
    const oid = extension.children[0] ? oidOf(extension.children[0].value) : "";
    const octets = extension.children[extension.children.length - 1];
    if (!octets || octets.tag !== 0x04) continue;
    let value: Asn1;
    try {
      value = readAsn1(octets.value);
    } catch {
      continue;
    }
    switch (oid) {
      case "2.5.29.17":
        certificate.altNames = altNamesOf(value);
        break;
      case "2.5.29.19":
        certificate.isCa = value.children.some((entry) => entry.tag === 0x01 && entry.value[0] !== 0);
        certificate.pathLength = value.children.find((entry) => entry.tag === 0x02) ? Number(BigInt(`0x${hex(value.children.find((entry) => entry.tag === 0x02)!.value) || "0"}`)) : null;
        break;
      case "2.5.29.15": {
        const unused = value.value[0] ?? 0;
        const bits = value.value.subarray(1);
        const usages: string[] = [];
        for (let bit = 0; bit < bits.length * 8 - unused && bit < KEY_USAGES.length; bit += 1) if (bits[bit >> 3] & (0x80 >> (bit & 7))) usages.push(KEY_USAGES[bit]);
        certificate.keyUsage = usages;
        break;
      }
      case "2.5.29.37":
        certificate.extendedKeyUsage = value.children.map((entry) => KEY_PURPOSES[oidOf(entry.value)] ?? oidOf(entry.value));
        break;
      case "2.5.29.32":
        certificate.policies = value.children.map((entry) => (entry.children[0] ? oidOf(entry.children[0].value) : "")).map((policy) => (POLICIES[policy] ? `${POLICIES[policy]} (${policy})` : policy));
        break;
      case "2.5.29.14":
        certificate.subjectKeyId = hex(value.value, ":").toUpperCase();
        break;
      case "2.5.29.35": {
        const id = value.children.find((entry) => entry.tag === 0x80);
        certificate.authorityKeyId = id ? hex(id.value, ":").toUpperCase() : null;
        break;
      }
      case "2.5.29.31":
        certificate.crls = uriList(value);
        break;
      case "1.3.6.1.5.5.7.1.1":
        for (const access of value.children) {
          const method = access.children[0] ? oidOf(access.children[0].value) : "";
          const uris = access.children[1] ? uriList(access.children[1]) : [];
          if (method === "1.3.6.1.5.5.7.48.1") certificate.ocsp.push(...uris);
          else if (method === "1.3.6.1.5.5.7.48.2") certificate.issuerUrls.push(...uris);
        }
        break;
    }
  }
}

function fingerprint(algorithm: "sha256" | "sha1", der: Uint8Array): string {
  const digest = createDigest(algorithm);
  digest.update(der);
  return digest.hex().toUpperCase().replace(/(..)(?!$)/g, "$1:");
}

function blank(der: Uint8Array, kind: Certificate["kind"]): Certificate {
  return { kind, der, version: 1, serial: "", subject: "", commonName: "", issuer: "", notBefore: null, notAfter: null, signature: "", key: "", altNames: [], isCa: null, pathLength: null, keyUsage: [], extendedKeyUsage: [], policies: [], ocsp: [], issuerUrls: [], crls: [], subjectKeyId: null, authorityKeyId: null, sha256: fingerprint("sha256", der), sha1: fingerprint("sha1", der) };
}

/** One certificate from its DER. */
export function parseCertificate(der: Uint8Array): Certificate {
  const root = readAsn1(der);
  const [tbs, algorithm] = root.children;
  if (!tbs || tbs.tag !== 0x30 || !algorithm) throw new Asn1Error("This is not an X.509 certificate: its outer structure is wrong.");
  const certificate = blank(root.raw, "certificate");
  let fields = tbs.children;
  if (fields[0]?.tag === 0xa0) {
    certificate.version = (fields[0].children[0]?.value[0] ?? 0) + 1;
    fields = fields.slice(1);
  }
  const [serial, , issuer, validity, subject, spki, ...rest] = fields;
  if (!serial || !issuer || !validity || !subject || !spki) throw new Asn1Error("This certificate is missing fields every certificate has.");
  certificate.serial = hex(serial.value, ":").replace(/^00:/, "").toUpperCase();
  certificate.issuer = nameOf(issuer).text;
  const named = nameOf(subject);
  certificate.subject = named.text;
  certificate.commonName = named.commonName ?? named.text;
  certificate.notBefore = validity.children[0] ? timeOf(validity.children[0]) : null;
  certificate.notAfter = validity.children[1] ? timeOf(validity.children[1]) : null;
  certificate.signature = algorithm.children[0] ? (ALGORITHMS[oidOf(algorithm.children[0].value)] ?? oidOf(algorithm.children[0].value)) : "";
  certificate.key = keyOf(spki);
  const extensions = rest.find((entry) => entry.tag === 0xa3);
  if (extensions?.children[0]) applyExtensions(certificate, extensions.children[0].children);
  return certificate;
}

/** A certificate signing request (PKCS #10) from its DER: the subject, the key and the names asked for. */
export function parseRequest(der: Uint8Array): Certificate {
  const root = readAsn1(der);
  const [info, algorithm] = root.children;
  if (!info || !algorithm) throw new Asn1Error("This is not a certificate signing request: its outer structure is wrong.");
  const request = blank(root.raw, "request");
  const [, subject, spki, attributes] = info.children;
  if (!subject || !spki) throw new Asn1Error("This request is missing its subject or its key.");
  const named = nameOf(subject);
  request.subject = named.text;
  request.commonName = named.commonName ?? named.text;
  request.key = keyOf(spki);
  request.signature = algorithm.children[0] ? (ALGORITHMS[oidOf(algorithm.children[0].value)] ?? oidOf(algorithm.children[0].value)) : "";
  for (const attribute of attributes?.children ?? []) {
    // The extensionRequest attribute carries the extensions the certificate is to have.
    if (attribute.children[0] && oidOf(attribute.children[0].value) === "1.2.840.113549.1.9.14") {
      const extensions = attribute.children[1]?.children[0];
      if (extensions) applyExtensions(request, extensions.children);
    }
  }
  return request;
}

/* ---- PEM ----------------------------------------------------------------- */

export interface PemBlock {
  label: string;
  der: Uint8Array;
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Every PEM block in a text, in order. */
export function pemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    try {
      blocks.push({ label: match[1], der: base64Bytes(match[2].replace(/^[A-Za-z-]+:.*$/gm, "")) });
    } catch {
      // A block whose base64 is broken is skipped; the rest are still read.
    }
  }
  return blocks;
}

export function toPem(der: Uint8Array, label = "CERTIFICATE"): string {
  let binary = "";
  for (let index = 0; index < der.length; index += 0x8000) binary += String.fromCharCode(...der.subarray(index, index + 0x8000));
  return `-----BEGIN ${label}-----\n${(btoa(binary).match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${label}-----\n`;
}

export interface ReadCertificates {
  certificates: Certificate[];
  /** PEM blocks that are not certificates: keys, most of all. */
  others: string[];
  /** The file was PEM rather than raw DER. */
  pem: boolean;
}

/** The certificates and requests in a file, PEM or DER. */
export function readCertificates(bytes: Uint8Array): ReadCertificates {
  const text = new TextDecoder("latin1").decode(bytes);
  if (text.includes("-----BEGIN ")) {
    const certificates: Certificate[] = [];
    const others: string[] = [];
    for (const block of pemBlocks(text)) {
      if (block.label === "CERTIFICATE" || block.label === "X509 CERTIFICATE" || block.label === "TRUSTED CERTIFICATE") certificates.push(parseCertificate(block.der));
      else if (block.label === "CERTIFICATE REQUEST" || block.label === "NEW CERTIFICATE REQUEST") certificates.push(parseRequest(block.der));
      else others.push(block.label);
    }
    return { certificates, others, pem: true };
  }
  if (bytes[0] !== 0x30) throw new Asn1Error("This is neither a PEM file nor a DER certificate.");
  try {
    return { certificates: [parseCertificate(bytes)], others: [], pem: false };
  } catch {
    return { certificates: [parseRequest(bytes)], others: [], pem: false };
  }
}

/** "valid for 83 more days", "expired 3 days ago", "not valid until ...". */
export function validity(certificate: Certificate, now: Date): { state: "valid" | "expired" | "future" | "unknown"; text: string } {
  if (!certificate.notBefore || !certificate.notAfter) return { state: "unknown", text: "no validity dates" };
  const day = 86_400_000;
  if (now < certificate.notBefore) return { state: "future", text: `not valid until ${certificate.notBefore.toISOString().slice(0, 10)}` };
  if (now > certificate.notAfter) {
    const days = Math.floor((now.getTime() - certificate.notAfter.getTime()) / day);
    return { state: "expired", text: `expired ${days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`}` };
  }
  const days = Math.floor((certificate.notAfter.getTime() - now.getTime()) / day);
  return { state: "valid", text: `valid for ${days} more ${days === 1 ? "day" : "days"}` };
}

/** A certificate as a report a person can read. */
export function describeCertificate(certificate: Certificate, now: Date): string {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label.padEnd(22)}${value}`);
  };
  add(certificate.kind === "request" ? "Signing request for" : "Subject", certificate.subject);
  if (certificate.kind === "certificate") {
    add("Issuer", certificate.subject === certificate.issuer ? `${certificate.issuer} (self-signed)` : certificate.issuer);
    add("Valid from", certificate.notBefore?.toUTCString());
    add("Valid until", certificate.notAfter?.toUTCString());
    add("Status", validity(certificate, now).text);
    add("Serial number", certificate.serial);
    add("Version", String(certificate.version));
  }
  add("Public key", certificate.key);
  add("Signature", certificate.signature);
  add("Names covered", certificate.altNames.join(", "));
  add("Certificate authority", certificate.isCa === null ? null : certificate.isCa ? `yes${certificate.pathLength !== null ? `, path length ${certificate.pathLength}` : ""}` : "no");
  add("Key usage", certificate.keyUsage.join(", "));
  add("Extended key usage", certificate.extendedKeyUsage.join(", "));
  add("Policies", certificate.policies.join(", "));
  add("OCSP", certificate.ocsp.join(", "));
  add("Issuer certificate", certificate.issuerUrls.join(", "));
  add("CRL", certificate.crls.join(", "));
  add("Subject key ID", certificate.subjectKeyId);
  add("Authority key ID", certificate.authorityKeyId);
  add("SHA-256 fingerprint", certificate.sha256);
  add("SHA-1 fingerprint", certificate.sha1);
  return lines.join("\n");
}

/** Whether each certificate is issued by the next, as a chain should be. */
export function chainGaps(certificates: readonly Certificate[]): number[] {
  const gaps: number[] = [];
  for (let index = 0; index + 1 < certificates.length; index += 1) {
    const current = certificates[index];
    const next = certificates[index + 1];
    if (current.kind !== "certificate" || next.kind !== "certificate") continue;
    const byKey = current.authorityKeyId && next.subjectKeyId ? current.authorityKeyId === next.subjectKeyId : null;
    if (byKey === false || (byKey === null && current.issuer !== next.subject)) gaps.push(index);
  }
  return gaps;
}
