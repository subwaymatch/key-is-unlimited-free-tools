/**
 * A log file summarised: what kind of log it is, the span of time it
 * covers, how many lines at each level, the messages that recur most once
 * their numbers and ids are taken out, and for a web server's access log
 * the status codes, the paths, the clients and the busiest hour.
 *
 * Lines are read one at a time from a stream, so the size of the file does
 * not matter; only counts are kept. Each line is tried as an Apache or
 * nginx access log line, a JSON object, a syslog line, and finally as any
 * line that starts with a date and has a level word in it. A line that
 * starts with white space, "at " or "Caused by" continues the entry above
 * it, as a stack trace does.
 */

export type LogFormat = "access" | "json" | "syslog" | "plain";

export const FORMAT_LABELS: Record<LogFormat, string> = {
  access: "web server access log (Apache or nginx)",
  json: "JSON lines",
  syslog: "syslog",
  plain: "application log",
};

export type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export const LEVELS: readonly Level[] = ["fatal", "error", "warn", "info", "debug", "trace"];

const LEVEL_WORDS: Record<string, Level> = {
  FATAL: "fatal",
  PANIC: "fatal",
  EMERG: "fatal",
  EMERGENCY: "fatal",
  ALERT: "fatal",
  CRIT: "fatal",
  CRITICAL: "fatal",
  SEVERE: "error",
  ERROR: "error",
  ERR: "error",
  WARN: "warn",
  WARNING: "warn",
  NOTICE: "info",
  INFO: "info",
  INFORMATION: "info",
  DEBUG: "debug",
  FINE: "debug",
  TRACE: "trace",
  FINEST: "trace",
  VERBOSE: "trace",
};

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const ACCESS = /^(\S+) \S+ (\S+) \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "(?:(\S+) (\S+)(?: \S+)?|[^"]*)" (\d{3}) (\d+|-)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const SYSLOG = /^(?:<\d+>)?(\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\S+) ([^:[\s]+)(?:\[\d+\])?: ?(.*)$/;
const SYSLOG_5424 = /^<(\d+)>1 (\S+) (\S+) (\S+) (\S+) (\S+) (?:-|\[.*?\]) ?(.*)$/;
const ISO_START = /^\[?(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(Z|[+-]\d{2}:?\d{2})?\]?/;
const LEVEL_WORD = /\b(FATAL|PANIC|EMERG(?:ENCY)?|ALERT|CRIT(?:ICAL)?|SEVERE|ERROR|ERR|WARN(?:ING)?|NOTICE|INFO(?:RMATION)?|DEBUG|FINE|TRACE|FINEST|VERBOSE)\b/i;
const CONTINUATION = /^(\s|at |Caused by|\.\.\. \d+ more|Traceback|During handling)/;

export interface LogLine {
  format: LogFormat;
  time: number | null;
  level: Level | null;
  message: string;
  access?: { client: string; method: string; path: string; status: number; bytes: number; agent: string; referrer: string };
}

function levelOf(word: unknown): Level | null {
  if (typeof word === "number") {
    // pino and bunyan write levels as numbers: 10 trace to 60 fatal.
    return word >= 60 ? "fatal" : word >= 50 ? "error" : word >= 40 ? "warn" : word >= 30 ? "info" : word >= 20 ? "debug" : "trace";
  }
  return typeof word === "string" ? (LEVEL_WORDS[word.toUpperCase()] ?? null) : null;
}

function jsonField(object: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (object[name] !== undefined) return object[name];
    // Dotted names, as Elastic's log.level.
    const nested = name.split(".").reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), object);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function timeOf(value: unknown): number | null {
  if (typeof value === "number") return value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** One line read as whichever format it fits, or null for a continuation or a blank. */
export function parseLogLine(line: string, year: number): LogLine | null {
  if (line.trim() === "") return null;
  const access = ACCESS.exec(line);
  if (access) {
    const [, client, , day, month, yearText, hour, minute, second, zone, method = "", target = "", status, bytes, referrer = "", agent = ""] = access;
    const offset = (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3)));
    const time = Date.UTC(Number(yearText), MONTHS[month] ?? 0, Number(day), Number(hour), Number(minute), Number(second)) - offset * 60000;
    const path = target.split("?")[0] || target;
    const code = Number(status);
    return { format: "access", time, level: code >= 500 ? "error" : code >= 400 ? "warn" : "info", message: `${method} ${path} ${status}`, access: { client, method, path, status: code, bytes: bytes === "-" ? 0 : Number(bytes), agent, referrer } };
  }
  if (line.startsWith("{")) {
    try {
      const object = JSON.parse(line) as Record<string, unknown>;
      if (object && typeof object === "object") {
        const message = jsonField(object, ["msg", "message", "event", "log", "text"]);
        return {
          format: "json",
          time: timeOf(jsonField(object, ["time", "timestamp", "ts", "@timestamp", "date", "datetime"])),
          level: levelOf(jsonField(object, ["level", "severity", "lvl", "log.level", "levelname", "loglevel"])),
          message: typeof message === "string" ? message : JSON.stringify(message ?? object),
        };
      }
    } catch {
      // Not JSON after all; read it as text.
    }
  }
  if (CONTINUATION.test(line)) return null;
  const syslog = SYSLOG.exec(line);
  if (syslog) {
    const [, month, day, hour, minute, second, , program, message] = syslog;
    if (MONTHS[month] !== undefined) {
      return { format: "syslog", time: Date.UTC(year, MONTHS[month], Number(day), Number(hour), Number(minute), Number(second)), level: levelOf(LEVEL_WORD.exec(message)?.[1]), message: `${program}: ${message}` };
    }
  }
  const modern = SYSLOG_5424.exec(line);
  if (modern) {
    const severity = Number(modern[1]) % 8;
    return { format: "syslog", time: timeOf(modern[2]), level: severity <= 2 ? "fatal" : severity === 3 ? "error" : severity === 4 ? "warn" : severity <= 6 ? "info" : "debug", message: `${modern[4]}: ${modern[7]}` };
  }
  const iso = ISO_START.exec(line);
  const word = LEVEL_WORD.exec(line.slice(0, 120));
  const time = iso ? timeOf(`${iso[1]}T${iso[2]}${iso[3] ?? "Z"}`.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : null;
  let message = line;
  if (iso) message = message.slice(iso[0].length);
  if (word) {
    const at = message.search(new RegExp(`\\b${word[1]}\\b`, "i"));
    if (at >= 0 && at < 80) message = message.slice(at + word[1].length);
  }
  message = message.replace(/^[\s\]:|-]+/, "").trim() || line.trim();
  return { format: "plain", time, level: levelOf(word?.[1]), message };
}

/** A message with what varies between occurrences taken out, so repeats count together. */
export function messagePattern(message: string): string {
  return message
    .slice(0, 300)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>")
    .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, "<mac>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/(["'])(?:(?!\1).){1,120}\1/g, "$1...$1")
    .replace(/\b\d+\.\d+\b/g, "<n>")
    .replace(/\b[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g, (token) => (/^\d+(\.\d+)?$/.test(token) ? "<n>" : /\d{3,}/.test(token) ? "<id>" : token.replace(/\d+/g, "<n>")))
    .replace(/\s+/g, " ")
    .trim();
}

export interface PatternCount {
  pattern: string;
  level: Level | null;
  count: number;
  example: string;
  firstLine: number;
  lastLine: number;
}

export interface Tally {
  key: string;
  count: number;
}

export interface LogSummary {
  lines: number;
  entries: number;
  continuations: number;
  formats: Record<LogFormat, number>;
  format: LogFormat;
  levels: Record<Level, number>;
  unlevelled: number;
  first: number | null;
  last: number | null;
  /** Entries per hour, keyed by the hour's start in milliseconds. */
  hours: Map<number, number>;
  patterns: PatternCount[];
  /** Patterns past the limit, counted together. */
  otherPatterns: number;
  access: {
    requests: number;
    bytes: number;
    statuses: Tally[];
    paths: Tally[];
    clients: Tally[];
    agents: Tally[];
    methods: Tally[];
    notFound: Tally[];
    serverErrors: Tally[];
    bots: number;
  } | null;
}

const MAX_PATTERNS = 20000;
const MAX_KEYS = 50000;

class Counter {
  private readonly counts = new Map<string, number>();
  private overflow = 0;

  add(key: string): void {
    const current = this.counts.get(key);
    if (current !== undefined) this.counts.set(key, current + 1);
    else if (this.counts.size < MAX_KEYS) this.counts.set(key, 1);
    else this.overflow += 1;
  }

  top(count: number): Tally[] {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, count)
      .map(([key, value]) => ({ key, count: value }));
  }
}

const BOT = /bot|crawler|spider|slurp|curl|wget|python-requests|httpclient|go-http|headless/i;

/** Summarises a log arriving in pieces. `year` places syslog lines, which carry none. */
export async function summarizeLog(chunks: AsyncIterable<string>, year: number, top = 20): Promise<LogSummary> {
  const summary: LogSummary = { lines: 0, entries: 0, continuations: 0, formats: { access: 0, json: 0, syslog: 0, plain: 0 }, format: "plain", levels: { fatal: 0, error: 0, warn: 0, info: 0, debug: 0, trace: 0 }, unlevelled: 0, first: null, last: null, hours: new Map(), patterns: [], otherPatterns: 0, access: null };
  const patterns = new Map<string, PatternCount>();
  const statuses = new Counter();
  const paths = new Counter();
  const clients = new Counter();
  const agents = new Counter();
  const methods = new Counter();
  const notFound = new Counter();
  const serverErrors = new Counter();
  let requests = 0;
  let bytes = 0;
  let bots = 0;
  let previousTimed = false;
  let carry = "";
  const handle = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    summary.lines += 1;
    let entry = parseLogLine(line, year);
    // In a log whose entries start with a time, a line without one belongs to the entry above:
    // the exception line of a Java stack trace, the rest of a multi-line message.
    if (entry && entry.format === "plain" && entry.time === null && entry.level === null && previousTimed) entry = null;
    if (entry) previousTimed = entry.time !== null;
    if (!entry) {
      if (line.trim() !== "") summary.continuations += 1;
      return;
    }
    summary.entries += 1;
    summary.formats[entry.format] += 1;
    if (entry.level) summary.levels[entry.level] += 1;
    else summary.unlevelled += 1;
    if (entry.time !== null && Number.isFinite(entry.time)) {
      if (summary.first === null || entry.time < summary.first) summary.first = entry.time;
      if (summary.last === null || entry.time > summary.last) summary.last = entry.time;
      const hour = Math.floor(entry.time / 3_600_000) * 3_600_000;
      summary.hours.set(hour, (summary.hours.get(hour) ?? 0) + 1);
    }
    const pattern = messagePattern(entry.message);
    const key = `${entry.level ?? ""}|${pattern}`;
    const existing = patterns.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastLine = summary.lines;
    } else if (patterns.size < MAX_PATTERNS) patterns.set(key, { pattern, level: entry.level, count: 1, example: entry.message.slice(0, 300), firstLine: summary.lines, lastLine: summary.lines });
    else summary.otherPatterns += 1;
    if (entry.access) {
      const { access } = entry;
      requests += 1;
      bytes += access.bytes;
      statuses.add(String(access.status));
      paths.add(access.path);
      clients.add(access.client);
      if (access.agent) agents.add(access.agent);
      if (access.method) methods.add(access.method);
      if (access.status === 404) notFound.add(access.path);
      if (access.status >= 500) serverErrors.add(access.path);
      if (BOT.test(access.agent)) bots += 1;
    }
  };
  for await (const chunk of chunks) {
    const text = carry + chunk;
    let start = 0;
    for (let newline = text.indexOf("\n"); newline !== -1; newline = text.indexOf("\n", start)) {
      handle(text.slice(start, newline));
      start = newline + 1;
    }
    carry = text.slice(start);
  }
  if (carry !== "") handle(carry);
  summary.format = (Object.entries(summary.formats) as [LogFormat, number][]).sort((a, b) => b[1] - a[1])[0][0];
  summary.patterns = [...patterns.values()].sort((a, b) => b.count - a.count || a.firstLine - b.firstLine);
  if (requests > 0) {
    summary.access = { requests, bytes, statuses: statuses.top(100), paths: paths.top(top), clients: clients.top(top), agents: agents.top(10), methods: methods.top(10), notFound: notFound.top(top), serverErrors: serverErrors.top(top), bots };
  }
  return summary;
}

function iso(time: number): string {
  return new Date(time).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function span(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round(hours / 24)} days`;
}

function table(headers: string[], rows: (string | number)[][]): string[] {
  const cell = (value: string | number) => String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)];
}

/** The summary as a Markdown report. */
export function logReport(name: string, summary: LogSummary, bytesTotal: number): string {
  const out: string[] = [`# ${name}`, ""];
  out.push(`- Kind: ${FORMAT_LABELS[summary.format]}`);
  out.push(`- Lines: ${summary.lines.toLocaleString("en")} (${summary.entries.toLocaleString("en")} entries${summary.continuations > 0 ? `, ${summary.continuations.toLocaleString("en")} continuation lines such as stack traces` : ""})`);
  out.push(`- Size: ${bytesTotal.toLocaleString("en")} bytes`);
  if (summary.first !== null && summary.last !== null) out.push(`- From ${iso(summary.first)} to ${iso(summary.last)}, ${span(summary.last - summary.first)}`);
  if (summary.hours.size > 0) {
    const [busiest, count] = [...summary.hours.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push(`- Busiest hour: ${iso(busiest).slice(0, 13)}:00 UTC, ${count.toLocaleString("en")} entries`);
  }
  out.push("");
  const levelled = LEVELS.filter((level) => summary.levels[level] > 0);
  if (levelled.length > 0) {
    out.push("## Levels", "", ...table(["Level", "Entries"], [...levelled.map((level) => [level.toUpperCase(), summary.levels[level].toLocaleString("en")]), ...(summary.unlevelled > 0 ? [["(none)", summary.unlevelled.toLocaleString("en")]] : [])]), "");
  }
  const problems = summary.patterns.filter((pattern) => pattern.level === "fatal" || pattern.level === "error" || pattern.level === "warn");
  if (problems.length > 0 && !summary.access) {
    out.push("## Most frequent errors and warnings", "", ...table(["Count", "Level", "Message", "First line", "Last line"], problems.slice(0, 25).map((pattern) => [pattern.count.toLocaleString("en"), (pattern.level ?? "").toUpperCase(), pattern.example, pattern.firstLine, pattern.lastLine])), "");
  }
  if (!summary.access) {
    out.push("## Most frequent messages", "", ...table(["Count", "Level", "Message"], summary.patterns.slice(0, 25).map((pattern) => [pattern.count.toLocaleString("en"), (pattern.level ?? "").toUpperCase(), pattern.pattern])), "");
  }
  if (summary.access) {
    const { access } = summary;
    out.push("## Requests", "", `- Requests: ${access.requests.toLocaleString("en")}, ${access.bytes.toLocaleString("en")} bytes sent`, `- From bots and scripts: ${access.bots.toLocaleString("en")} (${Math.round((access.bots / access.requests) * 100)}%)`, "");
    const classes = new Map<string, number>();
    for (const status of access.statuses) classes.set(`${status.key[0]}xx`, (classes.get(`${status.key[0]}xx`) ?? 0) + status.count);
    out.push("### Status codes", "", ...table(["Status", "Requests"], [...[...classes.entries()].sort().map(([key, count]) => [key, count.toLocaleString("en")]), ...access.statuses.map((status) => [status.key, status.count.toLocaleString("en")])]), "");
    out.push("### Most requested paths", "", ...table(["Requests", "Path"], access.paths.map((entry) => [entry.count.toLocaleString("en"), entry.key])), "");
    if (access.notFound.length > 0) out.push("### Not found (404)", "", ...table(["Requests", "Path"], access.notFound.map((entry) => [entry.count.toLocaleString("en"), entry.key])), "");
    if (access.serverErrors.length > 0) out.push("### Server errors (5xx)", "", ...table(["Requests", "Path"], access.serverErrors.map((entry) => [entry.count.toLocaleString("en"), entry.key])), "");
    out.push("### Busiest clients", "", ...table(["Requests", "Client"], access.clients.map((entry) => [entry.count.toLocaleString("en"), entry.key])), "");
    out.push("### User agents", "", ...table(["Requests", "User agent"], access.agents.map((entry) => [entry.count.toLocaleString("en"), entry.key.slice(0, 160)])), "");
  }
  return `${out.join("\n")}\n`;
}
