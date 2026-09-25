"use client";

import { useMemo, useState } from "react";

import { csvLine } from "@/lib/data/csv";
import { HarError, harRequests, sanitizeHar, type SanitizeOptions } from "@/lib/files/har";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("sanitize-har");

/** Past this a HAR cannot be parsed in a tab. */
const MAX_BYTES = 512 * 1024 * 1024;

function isSanitizeOptions(value: unknown): value is SanitizeOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SanitizeOptions>;
  return typeof candidate.dropRequestBodies === "boolean" && typeof candidate.dropResponseBodies === "boolean";
}

/** A browser's network log with the passwords, cookies and tokens taken out before it goes to a support desk. */
export function SanitizeHarApp() {
  const [settings, setSettings] = useState<SanitizeOptions>({ dropRequestBodies: false, dropResponseBodies: false });
  useStoredSettings(storageKey("settings", "sanitize-har"), settings, setSettings, isSanitizeOptions);
  const chosen = (["dropRequestBodies", "dropResponseBodies"] as const).filter((key) => settings[key]);

  const queue = useMemo<PlainQueueOptions<SanitizeOptions>>(
    () => ({
      key: "sanitize-har",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there is no log in it." } : file.size > MAX_BYTES ? { message: "This log is too large to read in a browser tab.", hint: `This reads HAR files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        report("Sanitising...", null);
        let result;
        try {
          result = sanitizeHar(text, current);
        } catch (error) {
          if (error instanceof HarError) throw new PlainError("This is not a HAR file.", error.message);
          throw error;
        }
        const { counts } = result;
        const json = JSON.stringify(result.har, null, 2);
        const requests = harRequests(result.har);
        const table = [csvLine(["started", "method", "status", "type", "bytes", "milliseconds", "url"], ",")];
        for (const request of requests) table.push(csvLine([request.started, request.method, String(request.status), request.type, String(request.bytes), String(request.milliseconds), request.url], ","));
        const hosts = new Set(requests.map((request) => request.url.match(/^[a-z]+:\/\/([^/]+)/i)?.[1] ?? "")).size;
        const changes = [
          counts.headers > 0 ? `${counts.headers} ${counts.headers === 1 ? "header" : "headers"}` : "",
          counts.cookies > 0 ? `${counts.cookies} ${counts.cookies === 1 ? "cookie" : "cookies"}` : "",
          counts.parameters > 0 ? `${counts.parameters} URL ${counts.parameters === 1 ? "parameter" : "parameters"}` : "",
          counts.bodyFields > 0 ? `${counts.bodyFields} body ${counts.bodyFields === 1 ? "field" : "fields"}` : "",
          counts.tokens > 0 ? `${counts.tokens} ${counts.tokens === 1 ? "token" : "tokens"} inside text` : "",
        ].filter(Boolean);
        return {
          facts: [`${requests.length.toLocaleString("en")} ${requests.length === 1 ? "request" : "requests"} to ${hosts} ${hosts === 1 ? "host" : "hosts"}`, `Redacted: ${changes.length > 0 ? changes.join(", ") : "nothing found"}`, ...(counts.bodiesRemoved > 0 ? [`Bodies removed: ${counts.bodiesRemoved}`] : [])],
          notes: ["Names, timings, sizes and the order of requests are kept, which is what whoever is debugging needs. Response bodies can still hold personal details such as a name or an address; remove them in the settings if the problem is not in them."],
          outputs: [
            { label: "Sanitised HAR", fileName: `${fileStem(file.name, "network")}-sanitised.har`, blob: new Blob([json], { type: "application/json" }), kind: "file", note: `${formatBytes(new Blob([json]).size)}, opens in any browser's network panel` },
            { label: "Requests as a table", fileName: `${fileStem(file.name, "network")}-requests.csv`, blob: new Blob([`${table.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }), kind: "file", note: "Method, status, type, size, time and URL of each" },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Bodies",
    summary: () => (chosen.length === 0 ? "kept, with credentials inside them redacted" : chosen.map((key) => (key === "dropRequestBodies" ? "request bodies removed" : "response bodies removed")).join(", ")),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Remove entirely</legend>
        <CheckboxCards
          aria-label="Remove entirely"
          value={chosen}
          onValueChange={(next) => setSettings({ dropRequestBodies: next.includes("dropRequestBodies"), dropResponseBodies: next.includes("dropResponseBodies") })}
          options={[
            { value: "dropRequestBodies", label: "Request bodies", blurb: "What forms and apps sent: logins, searches, messages" },
            { value: "dropResponseBodies", label: "Response bodies", blurb: "What came back: pages, data, account details" },
          ]}
        />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a HAR file - the network log a support desk asks you to save from your browser's developer tools - and get it back with the cookies, session tokens, passwords and API keys in it replaced, so it can be sent without handing over your login. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Sanitising"
      dropZone={{ accept: ".har,application/json", inputLabel: "Choose HAR files", headline: "Drop HAR files here", subhead: "Sanitised as they land" }}
      note="A HAR holds every cookie and every Authorization header your browser sent while it was recording, which is everything someone needs to use your account until those sessions end. Cookies are always replaced; headers, URL parameters, form fields and JSON fields are replaced when their names say they are credentials - token, secret, password, session, api key, auth - and a JSON Web Token is replaced wherever it appears. Signing out afterwards ends the sessions the log saw, whatever happens to it."
    />
  );
}
