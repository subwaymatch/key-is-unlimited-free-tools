/**
 * JSON Web Tokens read and checked: the header and the claims decoded, the
 * dates turned into dates, and the signature verified against a secret or a
 * public key with the browser's own Web Crypto.
 *
 * A JWT is three base64url parts joined by dots - a JSON header, a JSON
 * payload and a signature over the first two - so reading one takes no key
 * at all, which is the point worth making to anyone who thinks a token hides
 * what it carries. Verifying takes the key: the shared secret for the HS
 * algorithms, the public key for RS, PS, ES and EdDSA, given as a PEM
 * public key, a certificate, or a JWK or JWK set as a server publishes it.
 * An encrypted token (JWE, five parts) shows its header and nothing else.
 */
import { readAsn1 } from "./x509";

export class JwtError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** Bytes from base64url, or from plain base64 with padding. */
export function base64UrlBytes(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new JwtError("A part of this token is not base64url.", "Each part between the dots is letters, digits, - and _; something else got into it, or it was cut short.");
  const binary = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export interface DecodedJwt {
  kind: "signed" | "encrypted";
  header: Record<string, unknown>;
  /** The claims, or for a payload that is not JSON its text, or null for an encrypted token. */
  payload: unknown;
  /** The payload was JSON. */
  payloadIsJson: boolean;
  signature: Uint8Array;
  /** What the signature covers: the first two parts, dot and all. */
  signingInput: string;
  /** The token as read, without the Bearer prefix or whitespace. */
  token: string;
}

function jsonPart(part: string, what: string): Record<string, unknown> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(base64UrlBytes(part));
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new JwtError(`The ${what} is not JSON.`, `It decodes to "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}", so this is not a JWT, or the first part was lost.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JwtError(`The ${what} is not a JSON object.`, "A JWT header is always an object with at least an alg field.");
  return value as Record<string, unknown>;
}

/** The token's parts decoded. Throws JwtError when it is not a JWT. */
export function decodeJwt(input: string): DecodedJwt {
  const token = input
    .trim()
    .replace(/^(authorization:\s*)?bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (token === "") throw new JwtError("Paste a token first.", "A JWT starts with eyJ and has two dots in it.");
  const parts = token.split(".");
  if (parts.length === 5) {
    return { kind: "encrypted", header: jsonPart(parts[0], "header"), payload: null, payloadIsJson: false, signature: new Uint8Array(0), signingInput: "", token };
  }
  if (parts.length !== 3) throw new JwtError(`This has ${parts.length} ${parts.length === 1 ? "part" : "parts"}, not three.`, parts.length === 1 ? "A JWT is three base64url parts joined by dots; this has no dots, so it is some other kind of token or only one part of one." : "A signed JWT is three parts joined by dots, and an encrypted one five; some of it is missing.");
  const header = jsonPart(parts[0], "header");
  const bytes = base64UrlBytes(parts[1]);
  const text = new TextDecoder().decode(bytes);
  let payload: unknown = text;
  let payloadIsJson = false;
  try {
    payload = JSON.parse(text);
    payloadIsJson = true;
  } catch {
    // A JWS may carry any payload; only a JWT's is JSON claims.
  }
  return { kind: "signed", header, payload, payloadIsJson, signature: base64UrlBytes(parts[2]), signingInput: `${parts[0]}.${parts[1]}`, token };
}

/* ---- Claims --------------------------------------------------------------- */

const CLAIM_NAMES: Record<string, string> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expires",
  nbf: "Not before",
  iat: "Issued",
  jti: "Token ID",
  azp: "Authorized party",
  scope: "Scope",
  scp: "Scope",
  roles: "Roles",
  email: "Email",
  name: "Name",
  nonce: "Nonce",
  sid: "Session",
  auth_time: "Signed in",
  client_id: "Client",
  tid: "Tenant",
  oid: "Object ID",
  upn: "User principal name",
  preferred_username: "Username",
};

const HEADER_NAMES: Record<string, string> = {
  alg: "Algorithm",
  typ: "Type",
  kid: "Key ID",
  cty: "Content type",
  jku: "Key set URL",
  x5u: "Certificate URL",
  x5t: "Certificate thumbprint",
  "x5t#S256": "Certificate thumbprint (SHA-256)",
  enc: "Encryption",
  zip: "Compression",
};

const TIME_CLAIMS = new Set(["exp", "nbf", "iat", "auth_time", "updated_at"]);

/** "3 hours", "2 days", "45 seconds". */
export function span(seconds: number): string {
  const units: [number, string][] = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  const magnitude = Math.abs(seconds);
  for (const [size, unit] of units) {
    if (magnitude >= size || unit === "second") {
      const count = Math.floor(magnitude / size);
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
  return "0 seconds";
}

function when(seconds: number, now: number): string {
  const date = new Date(seconds * 1000);
  const iso = Number.isFinite(date.getTime()) ? date.toISOString().replace(".000Z", "Z").replace("T", " ") : String(seconds);
  const delta = seconds - now;
  return `${iso} (${Math.abs(delta) < 1 ? "now" : delta > 0 ? `in ${span(delta)}` : `${span(delta)} ago`})`;
}

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value.join(", ");
  return JSON.stringify(value);
}

export interface Claim {
  key: string;
  label: string;
  value: string;
}

/** A header's or payload's fields as rows, dates as dates. */
export function describeFields(fields: Record<string, unknown>, now: number, part: "header" | "payload"): Claim[] {
  const names = part === "header" ? HEADER_NAMES : CLAIM_NAMES;
  return Object.entries(fields).map(([key, value]) => ({
    key,
    label: names[key] ?? key,
    value: part === "payload" && TIME_CLAIMS.has(key) && typeof value === "number" ? when(value, now) : show(value),
  }));
}

export interface TimeState {
  state: "valid" | "expired" | "early" | "no-expiry";
  text: string;
}

/** Whether the token is in date, from exp and nbf. `now` is in seconds. */
export function timeState(payload: unknown, now: number): TimeState {
  const claims = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : null;
  if (nbf !== null && now < nbf) return { state: "early", text: `Not valid yet: it starts in ${span(nbf - now)}.` };
  if (exp !== null && now >= exp) return { state: "expired", text: `Expired ${span(now - exp)} ago.` };
  if (exp !== null) {
    const iat = typeof claims.iat === "number" ? claims.iat : null;
    return { state: "valid", text: `In date: it expires in ${span(exp - now)}${iat !== null && exp > iat ? `, of a lifetime of ${span(exp - iat)}` : ""}.` };
  }
  return { state: "no-expiry", text: "It never expires: there is no exp claim." };
}

/** Things worth a warning that are not the signature. */
export function tokenWarnings(decoded: DecodedJwt): string[] {
  const warnings: string[] = [];
  const alg = String(decoded.header.alg ?? "");
  if (alg.toLowerCase() === "none") warnings.push('The algorithm is "none": the token is not signed, so anyone could have written it. A server must never accept one.');
  if (decoded.kind === "signed" && decoded.payloadIsJson && decoded.payload && typeof decoded.payload === "object") {
    const claims = decoded.payload as Record<string, unknown>;
    if (typeof claims.exp === "number" && typeof claims.iat === "number" && claims.exp < claims.iat) warnings.push("It expires before it was issued, so no server should accept it.");
    for (const key of ["exp", "nbf", "iat"]) {
      const value = claims[key];
      if (value !== undefined && typeof value !== "number") warnings.push(`The ${key} claim is ${typeof value === "string" ? "a string" : "not a number"}; it should be seconds since 1970, which many servers then fail to read.`);
      else if (typeof value === "number" && value > 1e11) warnings.push(`The ${key} claim looks like milliseconds rather than seconds, which puts it thousands of years away.`);
    }
    const secretish = Object.keys(claims).filter((key) => /pass(word)?|secret|pwd|card|ssn/i.test(key));
    if (secretish.length > 0) warnings.push(`It carries ${secretish.map((key) => `"${key}"`).join(", ")}. The payload is readable by anyone who holds the token; it is signed, not encrypted.`);
  }
  if (typeof decoded.header.jku === "string" || typeof decoded.header.x5u === "string") warnings.push("The header names a URL to fetch its key from. A server should only ever use keys it already trusts, never ones a token points to.");
  return warnings;
}

/* ---- Signatures ----------------------------------------------------------- */

type Family = "HS" | "RS" | "PS" | "ES" | "EdDSA";

interface Algorithm {
  family: Family;
  hash: "SHA-256" | "SHA-384" | "SHA-512";
  curve?: "P-256" | "P-384" | "P-521";
}

export function algorithmOf(alg: string): Algorithm | null {
  const match = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (match) {
    const hash = `SHA-${match[2]}` as Algorithm["hash"];
    const family = match[1] as Family;
    return family === "ES" ? { family, hash, curve: match[2] === "256" ? "P-256" : match[2] === "384" ? "P-384" : "P-521" } : { family, hash };
  }
  if (alg === "EdDSA" || alg === "Ed25519") return { family: "EdDSA", hash: "SHA-512" };
  return null;
}

export type SecretEncoding = "text" | "base64";

export interface Verification {
  state: "valid" | "invalid" | "unsupported" | "bad-key";
  text: string;
}

function der(tag: number, content: Uint8Array): Uint8Array {
  const length = content.length;
  const head = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : length < 0x10000 ? [0x82, length >> 8, length & 0xff] : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];
  const out = new Uint8Array(1 + head.length + length);
  out[0] = tag;
  out.set(head, 1);
  out.set(content, 1 + head.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A PKCS #1 RSA public key wrapped as the SubjectPublicKeyInfo Web Crypto imports. */
export function rsaSpki(pkcs1: Uint8Array): Uint8Array {
  const rsaEncryption = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, concat(der(0x30, rsaEncryption), der(0x03, concat(new Uint8Array([0]), pkcs1))));
}

/** The SubjectPublicKeyInfo inside a certificate. */
export function certificateSpki(certificate: Uint8Array): Uint8Array {
  const tbs = readAsn1(certificate).children[0];
  const fields = tbs?.children[0]?.tag === 0xa0 ? tbs.children.slice(1) : (tbs?.children ?? []);
  const spki = fields[5];
  if (!spki) throw new JwtError("This certificate has no public key in the usual place.", "Paste the PEM public key instead.");
  return spki.raw;
}

function pemBody(text: string, label: string): Uint8Array | null {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`).exec(text);
  if (!match) return null;
  const binary = atob(match[1].replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function importParams(algorithm: Algorithm): RsaHashedImportParams | EcKeyImportParams | { name: string } {
  switch (algorithm.family) {
    case "RS":
      return { name: "RSASSA-PKCS1-v1_5", hash: algorithm.hash };
    case "PS":
      return { name: "RSA-PSS", hash: algorithm.hash };
    case "ES":
      return { name: "ECDSA", namedCurve: algorithm.curve ?? "P-256" };
    default:
      return { name: "Ed25519" };
  }
}

function verifyParams(algorithm: Algorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  switch (algorithm.family) {
    case "HS":
      return "HMAC";
    case "RS":
      return "RSASSA-PKCS1-v1_5";
    case "PS":
      return { name: "RSA-PSS", saltLength: Number(algorithm.hash.slice(4)) / 8 };
    case "ES":
      return { name: "ECDSA", hash: algorithm.hash };
    default:
      return "Ed25519";
  }
}

/** The public key from what was pasted: a PEM key or certificate, or a JWK or JWK set. */
async function publicKey(material: string, algorithm: Algorithm, kid: unknown): Promise<CryptoKey> {
  const text = material.trim();
  const params = importParams(algorithm);
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new JwtError("The key looks like JSON but does not parse.", "Paste a JWK, a JWK set, or a PEM public key.");
    }
    const record = parsed as { keys?: unknown };
    let jwk = parsed as JsonWebKey & { kid?: string };
    if (Array.isArray(record.keys)) {
      const keys = record.keys as (JsonWebKey & { kid?: string })[];
      const found = keys.find((key) => kid !== undefined && key.kid === kid) ?? (keys.length === 1 ? keys[0] : undefined);
      if (!found) throw new JwtError(kid !== undefined ? `No key in this set has the token's key ID, "${String(kid)}".` : "The set has several keys and the token names none.", "The server may have rotated its keys since the token was signed.");
      jwk = found;
    }
    if (jwk.kty === "oct") throw new JwtError("This is a shared-secret key, not a public key.", `The token is signed with ${algorithm.family}, which a public key checks.`);
    // A key published for "sig" with its own alg would be refused for the verify-only import below.
    const bare: JsonWebKey = { ...jwk };
    delete bare.alg;
    delete bare.key_ops;
    delete bare.use;
    return crypto.subtle.importKey("jwk", bare, params, false, ["verify"]);
  }
  let spki = pemBody(text, "PUBLIC KEY");
  const pkcs1 = pemBody(text, "RSA PUBLIC KEY");
  const certificate = pemBody(text, "CERTIFICATE");
  if (!spki && pkcs1) spki = rsaSpki(pkcs1);
  if (!spki && certificate) spki = certificateSpki(certificate);
  if (!spki) {
    if (/PRIVATE KEY-----/.test(text)) throw new JwtError("That is a private key.", "Verifying needs only the public half; never paste a private key anywhere you do not have to. Derive the public key with: openssl pkey -in key.pem -pubout");
    throw new JwtError("The key is not one this reads.", "Paste a PEM block starting -----BEGIN PUBLIC KEY-----, a certificate, or a JWK.");
  }
  return crypto.subtle.importKey("spki", spki as BufferSource, params, false, ["verify"]);
}

/** Checks the signature. `key` is the secret for HS, the public key otherwise. */
export async function verifyJwt(decoded: DecodedJwt, key: string, encoding: SecretEncoding = "text"): Promise<Verification> {
  const alg = String(decoded.header.alg ?? "");
  if (decoded.kind === "encrypted") return { state: "unsupported", text: "An encrypted token has no signature to check here; reading it takes the recipient's private key." };
  if (alg.toLowerCase() === "none") return { state: "invalid", text: "The token is not signed at all." };
  const algorithm = algorithmOf(alg);
  if (!algorithm) return { state: "unsupported", text: `The algorithm ${alg || "(missing)"} is not one a browser can check.` };
  const data = new TextEncoder().encode(decoded.signingInput);
  let cryptoKey: CryptoKey;
  try {
    if (algorithm.family === "HS") {
      if (key === "") return { state: "bad-key", text: "Type the secret to check the signature." };
      const secret = encoding === "base64" ? base64UrlBytes(key.trim()) : new TextEncoder().encode(key);
      cryptoKey = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: algorithm.hash }, false, ["verify"]);
    } else {
      if (key.trim() === "") return { state: "bad-key", text: "Paste the public key to check the signature." };
      cryptoKey = await publicKey(key, algorithm, decoded.header.kid);
    }
  } catch (error) {
    if (error instanceof JwtError) return { state: "bad-key", text: `${error.message} ${error.hint}` };
    if (algorithm.family === "EdDSA") return { state: "unsupported", text: "This browser cannot check Ed25519 signatures yet." };
    return { state: "bad-key", text: `The key could not be used for ${alg}: ${error instanceof Error ? error.message : String(error)}` };
  }
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(verifyParams(algorithm), cryptoKey, decoded.signature as BufferSource, data);
  } catch (error) {
    return { state: "bad-key", text: `The key does not fit ${alg}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (valid) return { state: "valid", text: `Signature verified: ${alg} with this ${algorithm.family === "HS" ? "secret" : "key"}.` };
  if (algorithm.family === "HS" && encoding === "text" && /^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(key.trim())) return { state: "invalid", text: "The signature does not match this secret. The secret looks like base64; try reading it as base64." };
  return { state: "invalid", text: `The signature does not match this ${algorithm.family === "HS" ? "secret" : "key"}: the token was signed with another, or was changed after signing.` };
}

/** The claims pretty-printed, for copying. */
export function prettyJson(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
