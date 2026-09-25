/**
 * A page that opens itself: files or a note sealed under a passphrase and
 * written into one HTML file, with the few lines of script that open it.
 *
 * The recipient needs nothing but a browser. The sealed bytes are this
 * site's own passphrase format (lib/crypto/passphrase.ts: PBKDF2-SHA-256 and
 * AES-256-GCM, a chunk at a time), base64 inside a script element that is
 * never run; the page's own script derives the key with the browser's Web
 * Crypto, checks and decrypts every chunk, and for files reads the ZIP they
 * were packed in - stored, not compressed, so reading it is a matter of
 * finding each file's bytes - and offers each one to save. The page loads
 * nothing and sends nothing: its Content-Security-Policy allows no network
 * access at all. The same file can be opened on this site as well, for a
 * reader whose browser or mail client will not run a page's scripts.
 *
 * The core functions are kept apart from the page wiring so the tests can
 * run exactly the code the page carries.
 */

export type LockedKind = "files" | "note";

/** Bytes per base64 line: 3,072 bytes become exactly 4,096 characters, so lines decode one by one. */
const LINE_BYTES = 3072;

/**
 * Decoding, decryption and ZIP reading, in plain ES2017 so any current
 * browser runs it. Defines keyisBase64, keyisOpen and keyisReadZip.
 */
export const CORE_SCRIPT = String.raw`
function keyisBase64(text) {
  var lines = text.split(/\s+/);
  var parts = [];
  var total = 0;
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    var binary = atob(lines[i]);
    parts.push(binary);
    total += binary.length;
  }
  var out = new Uint8Array(total);
  var at = 0;
  for (var p = 0; p < parts.length; p++) {
    var part = parts[p];
    for (var k = 0; k < part.length; k++) out[at++] = part.charCodeAt(k);
  }
  return out;
}

async function keyisOpen(sealed, passphrase, progress) {
  var HEADER = 40;
  var TAG = 16;
  var magic = "KEYISENC";
  for (var m = 0; m < 8; m++) if (sealed[m] !== magic.charCodeAt(m)) throw new Error("format");
  if (sealed[8] !== 1) throw new Error("version");
  var view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  var salt = sealed.slice(9, 25);
  var iterations = view.getUint32(25);
  var chunk = view.getUint32(29);
  var prefix = sealed.slice(33, 40);
  var header = sealed.slice(0, 40);
  var material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  var key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  var body = sealed.length - HEADER;
  var sealedChunk = chunk + TAG;
  var count = Math.ceil(body / sealedChunk);
  if (count < 1 || body - (count - 1) * sealedChunk < TAG) throw new Error("damaged");
  var out = new Uint8Array(body - count * TAG);
  var at = 0;
  for (var i = 0; i < count; i++) {
    var start = HEADER + i * sealedChunk;
    var nonce = new Uint8Array(12);
    nonce.set(prefix, 0);
    new DataView(nonce.buffer).setUint32(7, i);
    nonce[11] = i === count - 1 ? 1 : 0;
    var plain;
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: header }, key, sealed.slice(start, Math.min(sealed.length, start + sealedChunk))));
    } catch (error) {
      throw new Error(i === 0 ? "passphrase" : "damaged");
    }
    out.set(plain, at);
    at += plain.length;
    if (progress) progress((i + 1) / count);
  }
  return out;
}

function keyisReadZip(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var end = -1;
  for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("zip");
  var count = view.getUint16(end + 10, true);
  var offset = view.getUint32(end + 16, true);
  var decoder = new TextDecoder();
  var files = [];
  for (var n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip");
    var method = view.getUint16(offset + 10, true);
    var size = view.getUint32(offset + 20, true);
    var nameLength = view.getUint16(offset + 28, true);
    var extraLength = view.getUint16(offset + 30, true);
    var commentLength = view.getUint16(offset + 32, true);
    var local = view.getUint32(offset + 42, true);
    var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.charAt(name.length - 1) === "/") continue;
    if (method !== 0) throw new Error("zip");
    var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.push({ name: name, data: bytes.subarray(start, start + size) });
  }
  return files;
}
`;

/** The page's wiring: the form, the messages, and what is shown once it opens. */
const UI_SCRIPT = String.raw`
(function () {
  var form = document.getElementById("unlock");
  var input = document.getElementById("passphrase");
  var status = document.getElementById("status");
  var result = document.getElementById("result");
  var button = document.getElementById("open");
  var kind = document.getElementById("payload").getAttribute("data-kind");
  var size = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  };
  var link = function (name, bytes, label) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    a.download = name.split("/").pop() || "file";
    a.textContent = label;
    a.className = "save";
    return a;
  };
  if (!window.crypto || !crypto.subtle) {
    status.textContent = "This browser cannot open the file here: it has no Web Crypto. Open it in a current Chrome, Edge, Firefox or Safari.";
    button.disabled = true;
    return;
  }
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!input.value) return;
    button.disabled = true;
    status.textContent = "Checking the passphrase...";
    var sealed = keyisBase64(document.getElementById("payload").textContent);
    keyisOpen(sealed, input.value, function (share) {
      status.textContent = "Decrypting... " + Math.round(share * 100) + "%";
    }).then(function (plain) {
      form.hidden = true;
      status.textContent = "";
      result.hidden = false;
      if (kind === "note") {
        var text = new TextDecoder().decode(plain);
        var area = document.createElement("textarea");
        area.readOnly = true;
        area.value = text;
        area.rows = Math.min(24, Math.max(6, text.split("\n").length + 1));
        result.appendChild(area);
        var copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "Copy the note";
        copy.addEventListener("click", function () {
          area.select();
          if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { copy.textContent = "Copied"; }, function () { document.execCommand("copy"); });
          else document.execCommand("copy");
        });
        result.appendChild(copy);
        return;
      }
      var files = keyisReadZip(plain);
      var list = document.createElement("ul");
      files.forEach(function (file) {
        var item = document.createElement("li");
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = file.name;
        var meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = size(file.data.length);
        item.appendChild(name);
        item.appendChild(meta);
        item.appendChild(link(file.name, file.data, "Save"));
        list.appendChild(item);
      });
      result.appendChild(list);
      if (files.length > 1) result.appendChild(link("files.zip", plain, "Save them all as a ZIP"));
    }, function (error) {
      button.disabled = false;
      status.textContent = error.message === "passphrase" ? "That passphrase does not open it. Check for a typing mistake, or ask the sender." : "The file is damaged or cut short, so it cannot be opened. Ask the sender for it again.";
      input.select();
    });
  });
})();
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function base64Lines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += LINE_BYTES) {
    const slice = bytes.subarray(at, at + LINE_BYTES);
    let binary = "";
    for (let index = 0; index < slice.length; index += 1024) binary += String.fromCharCode(...slice.subarray(index, index + 1024));
    lines.push(btoa(binary));
  }
  return lines;
}

export interface LockedPageOptions {
  sealed: Uint8Array;
  kind: LockedKind;
  /** Shown above the passphrase box, in the clear. */
  message: string;
  /** For the page's own summary line, shown before it is opened. */
  summary: string;
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #111827; --muted: #5b6474; --line: #d9dee7; --accent: #1d5fb8; --bad: #b42318; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1320; --card: #151d2d; --text: #e7ebf2; --muted: #9aa5b8; --line: #2a3448; --accent: #8cc4ff; --bad: #f97066; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 36rem; margin: 3rem auto; padding: 0 1rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.25rem 1.5rem; }
h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
.muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
.message { white-space: pre-wrap; border-left: 3px solid var(--line); padding: 0.25rem 0 0.25rem 0.75rem; margin: 1rem 0 0; }
form { margin-top: 1.25rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
input { flex: 1 1 14rem; font: inherit; padding: 0.55rem 0.7rem; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); }
button, .save { font: inherit; font-weight: 600; padding: 0.55rem 0.95rem; border-radius: 8px; border: 0; background: var(--accent); color: var(--card); cursor: pointer; text-decoration: none; display: inline-block; }
button:disabled { opacity: 0.6; cursor: default; }
#status { min-height: 1.5rem; margin: 0.75rem 0 0; color: var(--bad); font-size: 0.95rem; }
ul { list-style: none; margin: 1rem 0; padding: 0; }
li { display: flex; gap: 0.75rem; align-items: center; padding: 0.55rem 0; border-top: 1px solid var(--line); }
.name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 0.9rem; }
textarea { width: 100%; font: 15px/1.5 ui-monospace, Menlo, Consolas, monospace; padding: 0.7rem; margin: 1rem 0 0.75rem; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
footer { margin-top: 1rem; }
`;

/** The page, as parts of a Blob, so a large payload is never one string. */
export function lockedPageParts(options: LockedPageOptions): string[] {
  const title = options.kind === "note" ? "Encrypted note" : "Encrypted files";
  const head = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; base-uri 'none'; form-action 'none'">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    '<div class="card">',
    `<h1>${title}</h1>`,
    `<p class="muted">${escapeHtml(options.summary)} Type the passphrase you were given to open ${options.kind === "note" ? "it" : "them"}; nothing is sent anywhere.</p>`,
    options.message.trim() ? `<p class="message">${escapeHtml(options.message.trim())}</p>` : "",
    '<noscript><p id="noscript">This page needs JavaScript to open. If it was opened in an e-mail preview, save it and open it in a browser, or open it on key.is.</p></noscript>',
    '<form id="unlock" autocomplete="off">',
    '<input id="passphrase" type="password" aria-label="Passphrase" placeholder="Passphrase" autofocus>',
    '<button id="open" type="submit">Open</button>',
    "</form>",
    '<p id="status" role="status"></p>',
    '<div id="result" hidden></div>',
    "</div>",
    '<footer><p class="muted">Sealed with AES-256-GCM under a key made from the passphrase (PBKDF2-SHA-256). Made with key.is, which runs in the browser and uploads nothing; this page opens offline.</p></footer>',
    "</main>",
    `<script type="application/x-keyis-sealed" id="payload" data-kind="${options.kind}">`,
  ].join("\n");
  const tail = ["</script>", `<script>${CORE_SCRIPT}${UI_SCRIPT}</script>`, "</body>", "</html>", ""].join("\n");
  const parts = [`${head}\n`];
  const lines = base64Lines(options.sealed);
  // A few thousand lines to a part keeps each string small.
  for (let at = 0; at < lines.length; at += 1024) parts.push(`${lines.slice(at, at + 1024).join("\n")}\n`);
  parts.push(tail);
  return parts;
}

export function lockedPageBlob(options: LockedPageOptions): Blob {
  return new Blob(lockedPageParts(options), { type: "text/html;charset=utf-8" });
}

/** The sealed bytes and kind from a page made here, or null when the HTML is not one. */
export function readLockedPage(html: string): { sealed: Uint8Array; kind: LockedKind } | null {
  const found = /<script type="application\/x-keyis-sealed" id="payload" data-kind="(files|note)">([\s\S]*?)<\/script>/.exec(html);
  if (!found) return null;
  const lines = found[2].split(/\s+/).filter(Boolean);
  const parts = lines.map((line) => Uint8Array.from(atob(line), (character) => character.charCodeAt(0)));
  const sealed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    sealed.set(part, at);
    at += part.length;
  }
  return { sealed, kind: found[1] as LockedKind };
}
