"use client";

import { Copy } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { algorithmOf, decodeJwt, describeFields, JwtError, prettyJson, timeState, tokenWarnings, verifyJwt, type DecodedJwt, type SecretEncoding, type Verification } from "@/lib/crypto/jwt";
import { requireTool } from "@/lib/tools";

import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import styles from "./DecodeJwtApp.module.css";

const tool = requireTool("decode-jwt");

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const EXAMPLE_SECRET = "correct horse battery staple";

/** A token signed here and now, so the example is always in date and never a real credential. */
async function exampleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: "https://login.example.com", sub: "user-1234", aud: "example-app", name: "Ada Lovelace", roles: ["reader", "editor"], iat: now, exp: now + 3600 }))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(EXAMPLE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
  return `${input}.${base64Url(signature)}`;
}

function Fields({ fields, now, part }: { fields: Record<string, unknown>; now: number; part: "header" | "payload" }) {
  const rows = describeFields(fields, now, part);
  if (rows.length === 0) return <p className={styles.hint}>Empty.</p>;
  return (
    <dl className={styles.fields}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "contents" }}>
          <dt className={styles.fieldName}>
            {row.label}
            {row.label !== row.key && <span className={styles.fieldKey}>{row.key}</span>}
          </dt>
          <dd className={styles.fieldValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, copy, children }: { title: string; copy?: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {copy !== undefined && (
          <Button onClick={() => copyText(copy)} variant="ghost" aria-label={`Copy the ${title.toLowerCase()} as JSON`}>
            <Copy aria-hidden="true" size={15} /> Copy JSON
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

const TIME_BADGES = { valid: styles.good, expired: styles.bad, early: styles.caution, "no-expiry": styles.neutral } as const;
const TIME_LABELS = { valid: "In date", expired: "Expired", early: "Not yet valid", "no-expiry": "No expiry" } as const;
const SIGNATURE_BADGES = { valid: styles.good, invalid: styles.bad, unsupported: styles.neutral, "bad-key": styles.caution } as const;
const SIGNATURE_LABELS = { valid: "Verified", invalid: "Does not match", unsupported: "Cannot check", "bad-key": "Needs a key" } as const;

/**
 * A JWT pasted and read: header, claims, dates, and the signature checked.
 *
 * Nothing here is remembered: not the token, not the secret, not the key.
 * They live in this component's state and go when the tab closes.
 */
export function DecodeJwtApp() {
  const [input, setInput] = useState("");
  const [key, setKey] = useState("");
  const [encoding, setEncoding] = useState<SecretEncoding>("text");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const decoded = useMemo<{ token: DecodedJwt } | { error: JwtError } | null>(() => {
    if (input.trim() === "") return null;
    try {
      return { token: decodeJwt(input) };
    } catch (error) {
      return { error: error instanceof JwtError ? error : new JwtError(String(error), "") };
    }
  }, [input]);

  const token = decoded && "token" in decoded ? decoded.token : null;
  const alg = token ? String(token.header.alg ?? "") : "";
  const family = algorithmOf(alg)?.family ?? null;

  useEffect(() => {
    if (!token) {
      setVerification(null);
      return;
    }
    let current = true;
    void verifyJwt(token, key, encoding).then((result) => {
      if (current) setVerification(result);
    });
    return () => {
      current = false;
    };
  }, [token, key, encoding]);

  const time = token && token.kind === "signed" && token.payloadIsJson ? timeState(token.payload, now) : null;
  const warnings = token ? tokenWarnings(token) : [];

  return (
    <ToolFrame
      tool={tool}
      lead="Paste a JSON Web Token to see what it carries: the header, every claim with its dates as dates, whether it has expired, and whether its signature checks out against a secret or a public key. Nothing is uploaded."
      footer={
        <PlainFootnote note="Reading a JWT takes no key: the header and claims are base64url, not encryption, which is why a token should never carry anything secret. Checking the signature takes the key it was signed with, the shared secret for HS256, HS384 and HS512, or the public key for RS, PS, ES and EdDSA, pasted as a PEM public key, a certificate, or a JWK or JWK set as an identity provider publishes it at its jwks_uri, where the key whose kid matches the token is used. Signatures are checked by the browser's own Web Crypto. Nothing typed here is saved, not even in this browser." />
      }
    >
      <section className={styles.card}>
        <label htmlFor="jwt-token" className={styles.label}>
          Token
        </label>
        <textarea
          id="jwt-token"
          className={styles.token}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setNow(Math.floor(Date.now() / 1000));
          }}
          placeholder="eyJhbGciOi..."
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <div className={styles.row}>
          <Button
            onClick={() => {
              void exampleToken().then((example) => {
                setInput(example);
                setNow(Math.floor(Date.now() / 1000));
                setKey(EXAMPLE_SECRET);
                setEncoding("text");
              });
            }}
          >
            Try an example
          </Button>
          {input !== "" && (
            <Button
              variant="ghost"
              onClick={() => {
                setInput("");
                setKey("");
              }}
            >
              Clear
            </Button>
          )}
          <span className={styles.hint}>A Bearer prefix or surrounding quotes are fine.</span>
        </div>
      </section>

      {decoded && "error" in decoded && (
        <div className={styles.alert} role="alert">
          <p className={styles.alertTitle}>{decoded.error.message}</p>
          {decoded.error.hint && <p className={styles.hint}>{decoded.error.hint}</p>}
        </div>
      )}

      {token && (
        <>
          {token.kind === "signed" && (
            <Section title="Claims" copy={prettyJson(token.payload)}>
              {time && (
                <>
                  <span className={`${styles.badge} ${TIME_BADGES[time.state]}`}>{TIME_LABELS[time.state]}</span>
                  <p className={styles.statusText}>{time.text}</p>
                  <div style={{ height: "0.75rem" }} />
                </>
              )}
              {token.payloadIsJson && token.payload && typeof token.payload === "object" && !Array.isArray(token.payload) ? <Fields fields={token.payload as Record<string, unknown>} now={now} part="payload" /> : <pre className={styles.raw}>{prettyJson(token.payload)}</pre>}
              {warnings.length > 0 && (
                <ul className={styles.warnings}>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Header" copy={prettyJson(token.header)}>
            <Fields fields={token.header} now={now} part="header" />
            {token.kind === "encrypted" && <p className={styles.statusText}>This is an encrypted token (JWE): only its header can be read. The claims are sealed for whoever holds the recipient&apos;s private key.</p>}
          </Section>

          {token.kind === "signed" && (
            <Section title="Signature">
              {verification && <span className={`${styles.badge} ${SIGNATURE_BADGES[verification.state]}`}>{SIGNATURE_LABELS[verification.state]}</span>}
              {verification && <p className={styles.statusText}>{verification.text}</p>}
              {family === "HS" && (
                <div className={styles.row} style={{ marginTop: "0.875rem" }}>
                  <label style={{ flex: "1 1 20rem" }}>
                    <span className={styles.label}>Secret</span>
                    <input type="text" className={styles.keyInput} value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} autoComplete="off" placeholder="The shared secret the server signs with" />
                  </label>
                  <label className={styles.check}>
                    <input type="checkbox" checked={encoding === "base64"} onChange={(event) => setEncoding(event.target.checked ? "base64" : "text")} /> The secret is base64
                  </label>
                </div>
              )}
              {family !== null && family !== "HS" && (
                <label style={{ display: "block", marginTop: "0.875rem" }}>
                  <span className={styles.label}>Public key</span>
                  <textarea className={styles.keyArea} value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} autoComplete="off" placeholder={"-----BEGIN PUBLIC KEY-----\n...\n\nor a certificate, a JWK, or a JWK set"} />
                </label>
              )}
            </Section>
          )}
        </>
      )}
    </ToolFrame>
  );
}
