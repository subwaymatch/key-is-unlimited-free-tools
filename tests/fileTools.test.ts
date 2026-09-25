import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import { chainGaps, describeCertificate, oidOf, pemBlocks, readAsn1, readCertificates, toPem, validity } from "@/lib/crypto/x509";
import { harRequests, isSensitiveName, REDACTED, sanitizeHar } from "@/lib/files/har";
import { redact, scanText, summarizeFindings } from "@/lib/files/secrets";

import { CHAIN_PEM, CSR_PEM, EC_PEM } from "./certificates";

describe("sanitising HAR files", () => {
  // Tokens are put together at run time so this file never holds one whole.
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
  const har = {
    log: {
      version: "1.2",
      entries: [
        {
          startedDateTime: "2026-09-01T10:00:00.000Z",
          time: 120.4,
          request: {
            method: "POST",
            url: `https://api.example.test/login?next=%2Fhome&access_token=abc123&code=xyz#frag`,
            headers: [{ name: "Authorization", value: `Bearer ${jwt}` }, { name: "Accept", value: "application/json" }, { name: "X-Author", value: "Ada" }],
            cookies: [{ name: "theme", value: "dark" }],
            queryString: [{ name: "next", value: "/home" }, { name: "access_token", value: "abc123" }],
            postData: { mimeType: "application/json", text: JSON.stringify({ user: "ada", password: "hunter2", author: "Ada", nested: { refresh_token: "r1", note: `see ${jwt}` } }) },
          },
          response: {
            status: 200,
            headers: [{ name: "Set-Cookie", value: "sid=s3cr3t; HttpOnly" }, { name: "Content-Type", value: "application/json" }],
            cookies: [{ name: "sid", value: "s3cr3t" }],
            content: { size: 42, mimeType: "application/json", text: JSON.stringify({ id_token: "t", code: 7, name: "Ada" }) },
            redirectURL: "",
          },
        },
        {
          startedDateTime: "2026-09-01T10:00:01.000Z",
          time: 30,
          request: { method: "POST", url: "https://example.test/form", headers: [], cookies: [], queryString: [], postData: { mimeType: "application/x-www-form-urlencoded", text: "user=ada&client_secret=zzz&code=abc", params: [{ name: "client_secret", value: "zzz" }] } },
          response: { status: 302, headers: [], cookies: [], content: { size: 0, mimeType: "text/html" }, redirectURL: "https://example.test/cb?token=t0k&x=1" },
        },
      ],
    },
  };

  it("knows a credential's name from an ordinary one", () => {
    expect(isSensitiveName("Authorization")).toBe(true);
    expect(isSensitiveName("X-CSRF-Token")).toBe(true);
    expect(isSensitiveName("author")).toBe(false);
    expect(isSensitiveName("code")).toBe(false);
    expect(isSensitiveName("code", true)).toBe(true);
  });

  it("redacts headers, cookies, parameters, body fields and tokens, and nothing else", () => {
    const { har: out, counts, entries } = sanitizeHar(JSON.stringify(har), { dropRequestBodies: false, dropResponseBodies: false });
    const [first, second] = (out as typeof har).log.entries;
    expect(entries).toBe(2);
    expect(first.request.url).toBe(`https://api.example.test/login?next=%2Fhome&access_token=${encodeURIComponent(REDACTED)}&code=${encodeURIComponent(REDACTED)}#frag`);
    expect(first.request.headers.map((header) => header.value)).toEqual([REDACTED, "application/json", "Ada"]);
    expect(first.request.cookies[0].value).toBe(REDACTED);
    expect(first.request.queryString.map((entry) => entry.value)).toEqual(["/home", REDACTED]);
    expect(JSON.parse(first.request.postData.text)).toEqual({ user: "ada", password: REDACTED, author: "Ada", nested: { refresh_token: REDACTED, note: `see ${REDACTED}` } });
    expect(first.response.headers[0].value).toBe(REDACTED);
    expect(JSON.parse(first.response.content.text!)).toEqual({ id_token: REDACTED, code: 7, name: "Ada" });
    expect(second.request.postData.text).toBe(`user=ada&client_secret=${encodeURIComponent(REDACTED)}&code=${encodeURIComponent(REDACTED)}`);
    expect(second.response.redirectURL).toBe(`https://example.test/cb?token=${encodeURIComponent(REDACTED)}&x=1`);
    expect(counts).toEqual({ headers: 2, cookies: 2, parameters: 4, bodyFields: 6, tokens: 1, bodiesRemoved: 0 });
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(JSON.stringify(out)).not.toContain(jwt);
  });

  it("drops bodies when asked, and lists the requests", () => {
    const { har: out, counts } = sanitizeHar(JSON.stringify(har), { dropRequestBodies: true, dropResponseBodies: true });
    expect(counts.bodiesRemoved).toBe(3);
    expect((out as typeof har).log.entries[0].response.content.text).toBeUndefined();
    expect(harRequests(out)).toEqual([
      { method: "POST", url: expect.stringContaining("api.example.test/login"), status: 200, type: "application/json", bytes: 42, milliseconds: 120, started: "2026-09-01T10:00:00.000Z" },
      { method: "POST", url: "https://example.test/form", status: 302, type: "text/html", bytes: 0, milliseconds: 30, started: "2026-09-01T10:00:01.000Z" },
    ]);
  });

  it("refuses what is not a HAR", () => {
    expect(() => sanitizeHar("{}", { dropRequestBodies: false, dropResponseBodies: false })).toThrow(/not a HAR/);
    expect(() => sanitizeHar("nope", { dropRequestBodies: false, dropResponseBodies: false })).toThrow(/not valid JSON/);
  });
});

describe("certificates", () => {
  const now = new Date(Date.UTC(2026, 9, 1));

  it("reads a chain the way Node's own X.509 parser does", () => {
    const { certificates, others, pem } = readCertificates(new TextEncoder().encode(CHAIN_PEM));
    expect(pem).toBe(true);
    expect(others).toEqual([]);
    expect(certificates).toHaveLength(2);
    const blocks = pemBlocks(CHAIN_PEM);
    for (const [index, certificate] of certificates.entries()) {
      const node = new X509Certificate(Buffer.from(blocks[index].der));
      expect(certificate.sha256).toBe(node.fingerprint256);
      expect(certificate.sha1).toBe(node.fingerprint);
      expect(certificate.serial).toBe(node.serialNumber.replace(/(..)(?!$)/g, "$1:"));
      expect(certificate.notBefore?.getTime()).toBe(new Date(node.validFrom).getTime());
      expect(certificate.notAfter?.getTime()).toBe(new Date(node.validTo).getTime());
    }
    const [leaf, root] = certificates;
    expect(leaf.subject).toBe('CN=leaf.example.test, O="Leaf \\"Quoted\\", Inc."');
    expect(leaf.commonName).toBe("leaf.example.test");
    expect(leaf.issuer).toBe("C=US, O=Test CA, CN=Test Root CA");
    expect(leaf.key).toBe("RSA 2048-bit");
    expect(leaf.signature).toBe("SHA-256 with RSA");
    expect(leaf.altNames).toEqual(["DNS:leaf.example.test"]);
    expect(leaf.ocsp).toEqual(["http://ocsp.example.test"]);
    expect(leaf.issuerUrls).toEqual(["http://ca.example.test/ca.crt"]);
    expect(leaf.crls).toEqual(["http://crl.example.test/ca.crl"]);
    expect(leaf.policies).toEqual(["domain validated (2.23.140.1.2.1)"]);
    expect(leaf.authorityKeyId).toBe(root.subjectKeyId);
    expect(root.isCa).toBe(true);
    expect(root.pathLength).toBe(0);
    expect(root.subject).toBe(root.issuer);
    expect(chainGaps(certificates)).toEqual([]);
    expect(chainGaps([root, leaf])).toEqual([0]);
    expect(validity(leaf, now)).toEqual({ state: "valid", text: expect.stringMatching(/^valid for \d+ more days$/) });
    expect(validity(leaf, new Date(Date.UTC(2027, 5, 1))).state).toBe("expired");
    expect(describeCertificate(leaf, now)).toContain("SHA-256 fingerprint");
  });

  it("reads alternative names of every kind, key usage and an elliptic curve key", () => {
    const [certificate] = readCertificates(new TextEncoder().encode(EC_PEM)).certificates;
    const node = new X509Certificate(EC_PEM);
    expect(certificate.key).toBe("ECDSA P-256");
    expect(certificate.signature).toBe("ECDSA with SHA-256");
    expect(certificate.altNames).toEqual(["DNS:www.example.test", "DNS:example.test", "IP:192.0.2.1", "email:admin@example.test"]);
    expect(node.subjectAltName).toBe("DNS:www.example.test, DNS:example.test, IP Address:192.0.2.1, email:admin@example.test");
    expect(certificate.keyUsage).toEqual(["digital signature"]);
    expect(certificate.extendedKeyUsage).toEqual(["TLS server", "TLS client"]);
  });

  it("reads DER, and turns it back into the same PEM", () => {
    const der = pemBlocks(EC_PEM)[0].der;
    const [certificate] = readCertificates(der).certificates;
    expect(certificate.commonName).toBe("www.example.test");
    expect(toPem(der).replace(/\s/g, "")).toBe(EC_PEM.replace(/\s/g, ""));
  });

  it("reads a signing request and the names it asks for", () => {
    const [request] = readCertificates(new TextEncoder().encode(CSR_PEM)).certificates;
    expect(request.kind).toBe("request");
    expect(request.subject).toBe("CN=req.example.test, O=Req Org");
    expect(request.altNames).toEqual(["DNS:req.example.test", "DNS:*.req.example.test"]);
    expect(request.key).toBe("RSA 2048-bit");
  });

  it("decodes object identifiers and refuses what is not DER", () => {
    expect(oidOf(Uint8Array.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]))).toBe("1.2.840.113549.1.1.11");
    expect(() => readAsn1(Uint8Array.from([0x30, 0x05, 0x01]))).toThrow(/past the end/);
    expect(() => readCertificates(new TextEncoder().encode("hello"))).toThrow(/neither/);
  });
});

describe("finding secrets", () => {
  const join = (...parts: string[]) => parts.join("");
  const github = join("gh", "p_", "R4nd0mT0k3nV4lu3F0rT3st1ngPurp0s3s12");
  const aws = join("AK", "IA", "Z7Q2W3E4R5T6Y7U8");
  const google = join("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q");
  const text = [
    "# config",
    `GITHUB_TOKEN=${github}`,
    `aws_access_key_id = ${aws}`,
    `const key = "${google}";`,
    "password = \"changeme\"",
    "db_password: 'S3cure!Passw0rd'",
    "DATABASE_URL=postgres://app:" + "Sup3rS3cret" + "@db.internal:5432/app",
    join("-----BEGIN ", "RSA PRIVATE KEY-----"),
    "MIIE...",
  ].join("\n");

  it("finds each kind once, with its line and column, and hides the middle", () => {
    const findings = scanText(text);
    expect(findings.map((finding) => [finding.rule, finding.line, finding.column])).toEqual([
      ["github-token", 2, 14],
      ["aws-access-key", 3, 21],
      ["google-api-key", 4, 14],
      ["assigned-secret", 6, 15],
      ["database-url", 7, 14],
      ["private-key", 8, 1],
    ]);
    expect(findings[0].preview).not.toContain(github.slice(8, 30));
    expect(findings[0].preview.startsWith(github.slice(0, 6))).toBe(true);
    expect(findings[5].preview).toBe("-----BEGIN RSA PRIVATE KEY-----");
    expect(summarizeFindings(findings)).toBe("GitHub token, AWS access key ID, Google API key, secret assigned in code or config, database URL with a password, private key");
  });

  it("leaves placeholders and ordinary text alone", () => {
    expect(scanText('api_key = "YOUR_API_KEY"\npassword: "xxxxxxxx"\nsecret = "${SECRET}"\nThe token is described in the docs.')).toEqual([]);
    expect(redact("abcdefghijklmnopqrst")).toBe("abcd************qrst");
  });
});
