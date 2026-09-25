"use client";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { archiveName, downloadAllAsZip, saveBlob } from "@/lib/download";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { capacityBytes, encodeQr, qrSvg, QrTooLongError, wifiText, type QrCode, type RenderOptions } from "@/lib/qr/encode";
import { ECC_LEVELS, ECC_RECOVERY, type EccLevel } from "@/lib/qr/tables";
import { requireTool } from "@/lib/tools";

import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import settingsStyles from "../Settings.module.css";
import styles from "./CreateQrCodeApp.module.css";

const tool = requireTool("create-qr-code");

type Content = "text" | "wifi" | "bulk";
type Format = "png" | "svg";
type Security = "WPA" | "WEP" | "nopass";

interface QrSettings {
  content: Content;
  level: EccLevel;
  format: Format;
  pixels: number;
  margin: number;
  dark: string;
  light: string;
  transparent: boolean;
}

const CONTENTS: { value: Content; label: string; blurb: string }[] = [
  { value: "text", label: "A link or text", blurb: "One code for a web address, a message, anything typed" },
  { value: "wifi", label: "A Wi-Fi network", blurb: "Phones join it when they scan, no typing the password" },
  { value: "bulk", label: "One code per line", blurb: "Many codes at once, saved together as a ZIP" },
];

const LEVELS: { value: EccLevel; label: string; blurb: string }[] = [
  { value: "L", label: "Low", blurb: `${ECC_RECOVERY.L} can be damaged: the smallest code, for screens` },
  { value: "M", label: "Medium", blurb: `${ECC_RECOVERY.M}: the usual choice for print` },
  { value: "Q", label: "Quartile", blurb: `${ECC_RECOVERY.Q}: for rough surfaces and outdoor signs` },
  { value: "H", label: "High", blurb: `${ECC_RECOVERY.H}: survives a logo or a scuff over it` },
];

const PIXELS = [512, 1024, 2048];
const MARGINS: { value: string; label: string; blurb: string }[] = [
  { value: "4", label: "Standard", blurb: "Four modules of white around it, as the standard asks" },
  { value: "2", label: "Narrow", blurb: "Two modules; fine on a plain background" },
  { value: "0", label: "None", blurb: "For placing into a design that has its own white space" },
];

const MAX_BULK = 1000;

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isQrSettings(value: unknown): value is QrSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<QrSettings>;
  return (
    CONTENTS.some((content) => content.value === candidate.content) &&
    ECC_LEVELS.includes(candidate.level as EccLevel) &&
    (candidate.format === "png" || candidate.format === "svg") &&
    PIXELS.includes(candidate.pixels as number) &&
    MARGINS.some((margin) => Number(margin.value) === candidate.margin) &&
    isHex(candidate.dark) &&
    isHex(candidate.light) &&
    typeof candidate.transparent === "boolean"
  );
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminanceOf(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** A file name from what a code says: "1-key-is-tools.png". */
function nameFor(text: string, index: number | null, extension: string): string {
  const slug =
    text
      .replace(/^https?:\/\/(www\.)?/i, "")
      .replace(/^WIFI:.*?S:([^;]*).*$/i, "wifi-$1")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .toLowerCase() || "qr-code";
  return `${index === null ? "" : `${index + 1}-`}${slug}.${extension}`;
}

async function pngOf(code: QrCode, options: RenderOptions, pixels: number): Promise<Blob> {
  const extent = code.size + options.margin * 2;
  // Whole pixels to a module, so every edge is sharp; the picture lands at or just under the size asked.
  const scale = Math.max(1, Math.floor(pixels / extent));
  const side = extent * scale;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d")!;
  if (options.light !== "transparent") {
    context.fillStyle = options.light;
    context.fillRect(0, 0, side, side);
  }
  context.fillStyle = options.dark;
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.modules[y * code.size + x]) context.fillRect((x + options.margin) * scale, (y + options.margin) * scale, scale, scale);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not write the PNG."))), "image/png"));
}

interface Made {
  text: string;
  code: QrCode | null;
  error: string | null;
}

/**
 * QR codes for links, text and Wi-Fi networks, one or a thousand.
 *
 * Only the look is remembered between visits. What the codes say - a
 * Wi-Fi password above all - lives in this component's state and nowhere
 * else.
 */
export function CreateQrCodeApp() {
  const [settings, setSettings] = useState<QrSettings>({ content: "text", level: "M", format: "png", pixels: 1024, margin: 4, dark: "#000000", light: "#ffffff", transparent: false });
  useStoredSettings(storageKey("settings", "create-qr-code"), settings, setSettings, isQrSettings);
  const [text, setText] = useState("");
  const [lines, setLines] = useState("");
  const [network, setNetwork] = useState<{ ssid: string; password: string; security: Security; hidden: boolean }>({ ssid: "", password: "", security: "WPA", hidden: false });
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<QrSettings>) => setSettings((previous) => ({ ...previous, ...patch }));

  const payloads = useMemo(() => {
    if (settings.content === "text") return text === "" ? [] : [text];
    if (settings.content === "wifi") return network.ssid === "" ? [] : [wifiText(network)];
    return lines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_BULK);
  }, [settings.content, text, lines, network]);

  const made = useMemo<Made[]>(
    () =>
      payloads.map((payload) => {
        try {
          return { text: payload, code: encodeQr(payload, { level: settings.level }), error: null };
        } catch (error) {
          return { text: payload, code: null, error: error instanceof QrTooLongError ? error.message : String(error) };
        }
      }),
    [payloads, settings.level],
  );

  const render: RenderOptions = { margin: settings.margin, dark: settings.dark, light: settings.transparent ? "transparent" : settings.light };
  const first = made.find((entry) => entry.code)?.code ?? null;
  const failed = made.filter((entry) => entry.error);
  const good = made.filter((entry): entry is Made & { code: QrCode } => entry.code !== null);
  const bytes = payloads[0] ? new TextEncoder().encode(payloads[0]).length : 0;

  const darkLum = luminanceOf(settings.dark);
  const lightLum = settings.transparent ? 1 : luminanceOf(settings.light);
  const contrast = (Math.max(darkLum, lightLum) + 0.05) / (Math.min(darkLum, lightLum) + 0.05);
  const warnings: string[] = [];
  if (darkLum > lightLum) warnings.push("The code is lighter than its background. Many scanners read only dark codes on light backgrounds.");
  else if (contrast < 3) warnings.push("The two colours are close in brightness, so cameras may struggle to tell the modules apart.");
  if (settings.transparent) warnings.push("With a transparent background the code needs a light surface behind it wherever it is placed.");
  if (settings.content === "bulk" && lines.split(/\r?\n/).filter((line) => line.trim()).length > MAX_BULK) warnings.push(`Only the first ${MAX_BULK} lines are made into codes.`);

  const download = async (format: Format) => {
    setBusy(true);
    try {
      const files = await Promise.all(
        good.map(async (entry, index) => ({
          fileName: nameFor(entry.text, good.length > 1 ? index : null, format),
          blob: format === "svg" ? new Blob([qrSvg(entry.code, render, settings.pixels)], { type: "image/svg+xml" }) : await pngOf(entry.code, render, settings.pixels),
        })),
      );
      if (files.length === 1) saveBlob(files[0].fileName, files[0].blob);
      else await downloadAllAsZip(files, archiveName("qr-codes"));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = first
    ? [
        ["Size", `${first.size} x ${first.size} modules (version ${first.version})`],
        ["Level", `${first.level}, ${ECC_RECOVERY[first.level]} can be damaged`],
        ["Holds", settings.content === "bulk" ? `${good.length} ${good.length === 1 ? "code" : "codes"}` : `${bytes.toLocaleString("en")} of ${capacityBytes(settings.level).toLocaleString("en")} bytes`],
        ["Written as", first.mode === "byte" ? "bytes (UTF-8)" : first.mode === "numeric" ? "digits, the densest mode" : "capitals and digits, a dense mode"],
      ]
    : [];

  return (
    <ToolFrame
      tool={tool}
      lead="Type a link or text, or a Wi-Fi network's name and password, and get a QR code to print or share, as a crisp PNG or a scalable SVG. Paste a list to make hundreds at once. Nothing is uploaded, and the codes never expire."
      footer={
        <PlainFootnote note="A QR code made here holds your text directly: there is no redirect service in between, so it keeps working forever and nobody counts the scans. Text is written in the densest mode it allows, the smallest version that holds it is chosen, and of the eight masks the standard defines the one that scans best is kept. The SVG is one path, sharp at any size; the PNG has whole pixels to a module. Wi-Fi codes use the format iPhone and Android cameras join networks from." />
      }
    >
      <section className={styles.card}>
        <RadioCards aria-label="What the code holds" value={settings.content} onValueChange={(value) => update({ content: value as Content })} options={CONTENTS} />
        {settings.content === "text" && (
          <div style={{ marginTop: "1rem" }}>
            <label htmlFor="qr-text" className={styles.label}>
              Link or text
            </label>
            <textarea id="qr-text" className={styles.textarea} value={text} onChange={(event) => setText(event.target.value)} placeholder="https://" spellCheck={false} />
          </div>
        )}
        {settings.content === "wifi" && (
          <div className={styles.fields}>
            <label>
              <span className={styles.fieldLabel}>Network name</span>
              <input className={styles.input} value={network.ssid} onChange={(event) => setNetwork((previous) => ({ ...previous, ssid: event.target.value }))} autoComplete="off" spellCheck={false} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Password</span>
              <input className={styles.input} value={network.password} disabled={network.security === "nopass"} onChange={(event) => setNetwork((previous) => ({ ...previous, password: event.target.value }))} autoComplete="off" spellCheck={false} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Security</span>
              <select className={styles.input} value={network.security} onChange={(event) => setNetwork((previous) => ({ ...previous, security: event.target.value as Security }))}>
                <option value="WPA">WPA, WPA2 or WPA3</option>
                <option value="WEP">WEP (old)</option>
                <option value="nopass">None, an open network</option>
              </select>
            </label>
            <label className={styles.check} style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={network.hidden} onChange={(event) => setNetwork((previous) => ({ ...previous, hidden: event.target.checked }))} /> The network is hidden
            </label>
          </div>
        )}
        {settings.content === "bulk" && (
          <div style={{ marginTop: "1rem" }}>
            <label htmlFor="qr-lines" className={styles.label}>
              One code per line
            </label>
            <textarea id="qr-lines" className={styles.textarea} style={{ minHeight: "10rem" }} value={lines} onChange={(event) => setLines(event.target.value)} placeholder={"https://example.com/table/1\nhttps://example.com/table/2\nhttps://example.com/table/3"} spellCheck={false} />
            <p className={styles.hint}>Each line becomes its own code, saved as its own file and named after what it says. Empty lines are skipped.</p>
          </div>
        )}
      </section>

      {first && (
        <section className={styles.card}>
          <div className={styles.result}>
            <div className={styles.preview} dangerouslySetInnerHTML={{ __html: qrSvg(first, render) }} role="img" aria-label={`QR code for ${payloads[0]}`} />
            <div>
              <dl className={styles.facts}>
                {facts.map(([name, value]) => (
                  <div key={name} style={{ display: "contents" }}>
                    <dt className={styles.factName}>{name}</dt>
                    <dd className={styles.factValue}>{value}</dd>
                  </div>
                ))}
              </dl>
              {warnings.map((warning) => (
                <p key={warning} className={styles.warning}>
                  {warning}
                </p>
              ))}
              <div className={styles.actions}>
                {good.length > 1 ? (
                  <Button variant="primary" onClick={() => void download(settings.format)} disabled={busy}>
                    <Download aria-hidden="true" size={16} /> Download {good.length} codes as {settings.format.toUpperCase()} (ZIP)
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={() => void download("png")} disabled={busy}>
                      <Download aria-hidden="true" size={16} /> PNG
                    </Button>
                    <Button onClick={() => void download("svg")} disabled={busy}>
                      <Download aria-hidden="true" size={16} /> SVG
                    </Button>
                  </>
                )}
              </div>
              {good.length > 1 && <p className={styles.hint}>The preview shows the first of the {good.length}.</p>}
            </div>
          </div>
        </section>
      )}
      {failed.length > 0 && (
        <p className={styles.error} role="alert">
          {failed.length === 1 && made.length === 1 ? failed[0].error : `${failed.length} ${failed.length === 1 ? "line is" : "lines are"} too long for a QR code and ${failed.length === 1 ? "was" : "were"} skipped: ${failed[0].error}`}
        </p>
      )}

      <section className={styles.card}>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Error correction</legend>
          <RadioCards aria-label="Error correction" value={settings.level} onValueChange={(value) => update({ level: value as EccLevel })} options={LEVELS} columns={2} />
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Quiet zone</legend>
          <RadioCards aria-label="Quiet zone" value={String(settings.margin)} onValueChange={(value) => update({ margin: Number(value) })} options={MARGINS} />
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Picture</legend>
          <RadioCards aria-label="PNG size" value={String(settings.pixels)} onValueChange={(value) => update({ pixels: Number(value) })} options={PIXELS.map((pixels) => ({ value: String(pixels), label: `${pixels} px`, blurb: pixels === 512 ? "For screens and messages" : pixels === 1024 ? "For print up to about 8 cm" : "For posters and large print" }))} />
          {settings.content === "bulk" && (
            <div style={{ marginTop: "0.75rem" }}>
              <RadioCards
                aria-label="Format"
                value={settings.format}
                onValueChange={(value) => update({ format: value as Format })}
                options={[
                  { value: "png", label: "PNG", blurb: "Pictures, for anything" },
                  { value: "svg", label: "SVG", blurb: "Vectors, sharp at any size, for print" },
                ]}
                columns={2}
              />
            </div>
          )}
          <div className={styles.colours}>
            <label className={styles.colour}>
              <input type="color" value={settings.dark} onChange={(event) => update({ dark: event.target.value })} /> Code
            </label>
            <label className={styles.colour}>
              <input type="color" value={settings.light} disabled={settings.transparent} onChange={(event) => update({ light: event.target.value })} /> Background
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={settings.transparent} onChange={(event) => update({ transparent: event.target.checked })} /> Transparent background
            </label>
          </div>
        </fieldset>
      </section>
    </ToolFrame>
  );
}
