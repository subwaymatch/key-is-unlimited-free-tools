/**
 * A HAR file - the network log a browser's developer tools save, which
 * support desks ask for - with the secrets taken out before it is sent.
 *
 * A HAR records every request a page made, with its headers, cookies,
 * query string and body, and every response with its headers and often its
 * body. That includes the session cookie and the bearer token that let
 * anyone holding the file act as you, which is how a support vendor's
 * breach became its customers' breach in 2023. Sanitising replaces the
 * values of cookies and of headers, parameters and JSON fields whose names
 * say they are credentials, and any JSON Web Token found in any text,
 * leaving the names, the timings and the shape of the traffic intact for
 * whoever is debugging it.
 */

export const REDACTED = "[redacted]";

/** Header names whose values are credentials, whatever the site. */
const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "x-csrf-token", "x-xsrf-token", "x-amz-security-token", "x-goog-api-key", "api-key", "x-access-token", "x-refresh-token", "x-session-id", "x-session-token"]);

/**
 * A name that reads like it holds a credential: token, secret, password,
 * session and the like. "auth" but not "author" or "authority".
 */
const SENSITIVE_NAME = /token|secret|passw(or)?d|\bpwd\b|session|sessid|auth(?!or(?!iz))|api[-_]?key|apikey|signature|\bsig\b|credential|private[-_]?key|\bjwt\b|\bsaml|\botp\b|nonce|csrf|xsrf/i;

/** In a URL or a form, "code" is an OAuth authorization code; in a JSON body it is usually an error code. */
const SENSITIVE_PARAMETER = /^(code|state_token|ticket)$/i;

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export function isSensitiveName(name: string, parameter = false): boolean {
  const lower = name.trim().toLowerCase();
  return SENSITIVE_HEADERS.has(lower) || SENSITIVE_NAME.test(lower) || (parameter && SENSITIVE_PARAMETER.test(lower));
}

export interface SanitizeOptions {
  /** Drop response bodies altogether rather than redacting inside them. */
  dropResponseBodies: boolean;
  /** Drop request bodies altogether. */
  dropRequestBodies: boolean;
}

export interface SanitizeCounts {
  headers: number;
  cookies: number;
  parameters: number;
  bodyFields: number;
  tokens: number;
  bodiesRemoved: number;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface NameValue {
  name?: unknown;
  value?: unknown;
}

function redactTokens(text: string, counts: SanitizeCounts): string {
  return text.replace(JWT, () => {
    counts.tokens += 1;
    return REDACTED;
  });
}

/** A JSON value with every field named like a credential emptied, and tokens in strings replaced. */
function redactJson(value: Json, counts: SanitizeCounts): Json {
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry, counts));
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveName(key) && (typeof entry === "string" || typeof entry === "number") && String(entry) !== "") {
        counts.bodyFields += 1;
        out[key] = REDACTED;
      } else out[key] = redactJson(entry, counts);
    }
    return out;
  }
  return typeof value === "string" ? redactTokens(value, counts) : value;
}

/** A form-encoded body or query with the credential parameters replaced. */
function redactForm(text: string, counts: SanitizeCounts, kind: "parameters" | "bodyFields"): string {
  return text
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      if (equals < 0) return pair;
      let name = pair.slice(0, equals);
      try {
        name = decodeURIComponent(name.replace(/\+/g, " "));
      } catch {
        // Keep the name as it was written.
      }
      if (!isSensitiveName(name, true) || pair.slice(equals + 1) === "") return pair;
      counts[kind] += 1;
      return `${pair.slice(0, equals)}=${encodeURIComponent(REDACTED)}`;
    })
    .join("&");
}

/** A body's text with credentials taken out, as JSON when it reads as JSON and as a form when it is one. */
function redactBody(text: string, mimeType: string, counts: SanitizeCounts): string {
  const trimmed = text.trimStart();
  if (/json/i.test(mimeType) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactJson(JSON.parse(text) as Json, counts));
    } catch {
      // Not JSON after all.
    }
  }
  if (/x-www-form-urlencoded/i.test(mimeType)) return redactForm(text, counts, "bodyFields");
  return redactTokens(text, counts);
}

function redactPairs(list: unknown, counts: SanitizeCounts, kind: keyof SanitizeCounts, all = false): void {
  if (!Array.isArray(list)) return;
  for (const entry of list as NameValue[]) {
    if (!entry || typeof entry !== "object" || typeof entry.value !== "string" || entry.value === "") continue;
    if (all || (typeof entry.name === "string" && isSensitiveName(entry.name, kind === "parameters" || kind === "bodyFields"))) {
      entry.value = REDACTED;
      counts[kind] += 1;
    } else entry.value = redactTokens(entry.value, counts);
  }
}

/** A URL with its credential parameters replaced, and a token in its path too. */
function redactUrl(url: string, counts: SanitizeCounts): string {
  const question = url.indexOf("?");
  if (question < 0) return redactTokens(url, counts);
  const hash = url.indexOf("#", question);
  const query = url.slice(question + 1, hash < 0 ? undefined : hash);
  const rest = hash < 0 ? "" : url.slice(hash);
  return `${redactTokens(url.slice(0, question), counts)}?${redactForm(query, counts, "parameters")}${rest}`;
}

export class HarError extends Error {}

/** The log with its credentials replaced, and how many of each kind were. */
export function sanitizeHar(text: string, options: SanitizeOptions): { har: unknown; counts: SanitizeCounts; entries: number } {
  let har: { log?: { entries?: unknown[] } };
  try {
    har = JSON.parse(text.replace(/^\ufeff/, ""));
  } catch (error) {
    throw new HarError(`This is not valid JSON, which a HAR file is: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!har || typeof har !== "object" || !har.log || !Array.isArray(har.log.entries)) throw new HarError("This JSON is not a HAR file: it has no log of entries.");
  const counts: SanitizeCounts = { headers: 0, cookies: 0, parameters: 0, bodyFields: 0, tokens: 0, bodiesRemoved: 0 };
  for (const raw of har.log.entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { request?: Record<string, unknown>; response?: Record<string, unknown> };
    const request = entry.request;
    if (request) {
      if (typeof request.url === "string") request.url = redactUrl(request.url, counts);
      redactPairs(request.headers, counts, "headers");
      redactPairs(request.cookies, counts, "cookies", true);
      redactPairs(request.queryString, counts, "parameters");
      const post = request.postData as { text?: unknown; mimeType?: unknown; params?: unknown } | undefined;
      if (post) {
        if (options.dropRequestBodies && (post.text || Array.isArray(post.params))) {
          if (typeof post.text === "string" && post.text !== "") counts.bodiesRemoved += 1;
          post.text = "";
          post.params = [];
        } else {
          if (typeof post.text === "string") post.text = redactBody(post.text, typeof post.mimeType === "string" ? post.mimeType : "", counts);
          redactPairs(post.params, counts, "bodyFields");
        }
      }
    }
    const response = entry.response;
    if (response) {
      redactPairs(response.headers, counts, "headers");
      redactPairs(response.cookies, counts, "cookies", true);
      const content = response.content as { text?: unknown; mimeType?: unknown; encoding?: unknown } | undefined;
      if (content && typeof content.text === "string" && content.text !== "") {
        if (options.dropResponseBodies) {
          counts.bodiesRemoved += 1;
          delete content.text;
          delete content.encoding;
        } else if (content.encoding !== "base64") content.text = redactBody(content.text, typeof content.mimeType === "string" ? content.mimeType : "", counts);
      }
      if (typeof response.redirectURL === "string") response.redirectURL = redactUrl(response.redirectURL, counts);
    }
  }
  return { har, counts, entries: har.log.entries.length };
}

export interface HarRequest {
  method: string;
  url: string;
  status: number;
  type: string;
  bytes: number;
  milliseconds: number;
  started: string;
}

/** The requests in order, for a table: what was asked for, what came back, how big and how slow. */
export function harRequests(har: unknown): HarRequest[] {
  const entries = (har as { log?: { entries?: unknown[] } }).log?.entries ?? [];
  return entries.map((raw) => {
    const entry = raw as { request?: { method?: string; url?: string }; response?: { status?: number; content?: { mimeType?: string; size?: number }; bodySize?: number }; time?: number; startedDateTime?: string };
    return {
      method: entry.request?.method ?? "",
      url: entry.request?.url ?? "",
      status: entry.response?.status ?? 0,
      type: (entry.response?.content?.mimeType ?? "").split(";")[0],
      bytes: Math.max(0, entry.response?.content?.size ?? entry.response?.bodySize ?? 0),
      milliseconds: Math.round(entry.time ?? 0),
      started: entry.startedDateTime ?? "",
    };
  });
}
