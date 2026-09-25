import { describe, expect, it } from "vitest";

import { logReport, messagePattern, parseLogLine, summarizeLog } from "@/lib/text/logs";

async function* once(text: string): AsyncGenerator<string> {
  for (let at = 0; at < text.length; at += 17) yield text.slice(at, at + 17);
}

const ACCESS = [
  '203.0.113.9 - - [10/Oct/2025:13:55:36 -0700] "GET /index.html?x=1 HTTP/1.1" 200 2326 "https://example.com/" "Mozilla/5.0 (Macintosh)"',
  '203.0.113.9 - - [10/Oct/2025:13:56:01 -0700] "GET /missing HTTP/1.1" 404 153 "-" "Mozilla/5.0 (Macintosh)"',
  '198.51.100.4 - frank [10/Oct/2025:14:10:00 -0700] "POST /api/save HTTP/1.1" 500 0 "-" "curl/8.4.0"',
  '198.51.100.4 - - [10/Oct/2025:14:11:00 -0700] "GET /index.html HTTP/2.0" 200 2326 "-" "Googlebot/2.1"',
].join("\n");

const APP = [
  "2025-10-10 13:55:36,120 INFO  [main] Server started on port 8080",
  "2025-10-10 13:55:40.001 ERROR [pool-1] Connection to 10.0.0.12:5432 refused after 3 attempts",
  "java.net.ConnectException: Connection refused",
  "    at org.postgresql.Driver.connect(Driver.java:285)",
  "    at com.example.Db.open(Db.java:42)",
  "2025-10-10 13:56:40.001 ERROR [pool-2] Connection to 10.0.0.13:5432 refused after 5 attempts",
  "2025-10-10T13:57:00Z WARN cache miss for user 4f3c2a1b9d8e7f60",
  "",
].join("\n");

describe("reading log lines", () => {
  it("reads an access log line with its time zone", () => {
    const line = parseLogLine(ACCESS.split("\n")[0], 2025)!;
    expect(line.format).toBe("access");
    expect(new Date(line.time!).toISOString()).toBe("2025-10-10T20:55:36.000Z");
    expect(line.access).toEqual({ client: "203.0.113.9", method: "GET", path: "/index.html", status: 200, bytes: 2326, agent: "Mozilla/5.0 (Macintosh)", referrer: "https://example.com/" });
  });

  it("reads JSON lines, syslog and plain application lines", () => {
    expect(parseLogLine('{"level":50,"time":1760104536000,"msg":"db down"}', 2025)).toMatchObject({ format: "json", level: "error", message: "db down", time: 1760104536000 });
    expect(parseLogLine('{"@timestamp":"2025-10-10T13:55:36Z","log":{"level":"warn"},"message":"slow"}', 2025)).toMatchObject({ format: "json", level: "warn", message: "slow" });
    const syslog = parseLogLine("Oct 10 13:55:36 web01 sshd[4242]: error: maximum authentication attempts exceeded", 2025)!;
    expect(syslog).toMatchObject({ format: "syslog", level: "error", message: "sshd: error: maximum authentication attempts exceeded" });
    expect(new Date(syslog.time!).toISOString()).toBe("2025-10-10T13:55:36.000Z");
    expect(parseLogLine("<11>1 2025-10-10T13:55:36Z host app 12 ID47 - disk failing", 2025)).toMatchObject({ format: "syslog", level: "error", message: "app: disk failing" });
    expect(parseLogLine(APP.split("\n")[1], 2025)).toMatchObject({ format: "plain", level: "error", message: "[pool-1] Connection to 10.0.0.12:5432 refused after 3 attempts" });
    expect(parseLogLine("    at com.example.Db.open(Db.java:42)", 2025)).toBeNull();
  });

  it("takes out what varies so repeats count together", () => {
    expect(messagePattern("[pool-1] Connection to 10.0.0.12:5432 refused after 3 attempts")).toBe(messagePattern("[pool-2] Connection to 10.0.0.13:5432 refused after 5 attempts"));
    expect(messagePattern("user 550e8400-e29b-41d4-a716-446655440000 took 12.5 ms")).toBe("user <uuid> took <n> ms");
  });
});

describe("summarising", () => {
  it("counts levels, spans the time, groups repeated errors and passes over stack traces", async () => {
    const summary = await summarizeLog(once(APP), 2025);
    expect(summary).toMatchObject({ lines: 7, entries: 4, continuations: 3, format: "plain", levels: { error: 2, warn: 1, info: 1 } });
    expect(summary.patterns[0]).toMatchObject({ count: 2, level: "error", firstLine: 2, lastLine: 6 });
    expect(summary.last! - summary.first!).toBe(84_000);
    const report = logReport("app.log", summary, APP.length);
    expect(report).toContain("- Kind: application log");
    expect(report).toContain("| 2 | ERROR | [pool-1] Connection to 10.0.0.12:5432 refused after 3 attempts | 2 | 6 |");
  });

  it("summarises an access log: statuses, paths, 404s, 5xx and bots", async () => {
    const summary = await summarizeLog(once(ACCESS), 2025);
    expect(summary.format).toBe("access");
    expect(summary.access).toMatchObject({ requests: 4, bytes: 4805, bots: 2 });
    expect(summary.access!.paths[0]).toEqual({ key: "/index.html", count: 2 });
    expect(summary.access!.notFound).toEqual([{ key: "/missing", count: 1 }]);
    expect(summary.access!.serverErrors).toEqual([{ key: "/api/save", count: 1 }]);
    const report = logReport("access.log", summary, ACCESS.length);
    expect(report).toContain("| 2xx | 2 |");
    expect(report).toContain("- Busiest hour: 2025-10-10 20:00 UTC, 2 entries");
  });
});
