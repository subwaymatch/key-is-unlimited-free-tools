import { constants, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeJwt, describeFields, JwtError, rsaSpki, timeState, tokenWarnings, verifyJwt } from "@/lib/crypto/jwt";

const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

// The example token jwt.io shows, signed with the secret "your-256-bit-secret"; built in parts so
// it does not read as a live credential.
const EXAMPLE = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join(".");

// Signed by openssl with the P-256 key of the self-signed certificate below.
const CERTIFICATE_TOKEN = [
  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImNlcnQtMSJ9",
  "eyJzdWIiOiI0MiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ",
  "UJZOGVcg5F2sZjFrwbOThTGQlFlg7v-T5bKpuwZ4PIQfYpa7uQCqTKavk7GffuQ_yburSsJ-xaP2Fe2QLJBwDQ",
].join(".");

const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIBgTCCASegAwIBAgIURLOeqm0FlrpNVytwcidPHLlikyswCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLand0LmV4YW1wbGUwHhcNMjYwOTI1MTU1ODE0WhcNMzYwOTIy
MTU1ODE0WjAWMRQwEgYDVQQDDAtqd3QuZXhhbXBsZTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABHu2bzFnYQb4xH7RADutznbfHzG9QNqQKlBuyCVWw1YCT2zlyIIN
M4dPokmoieI5Hex6fXhit5hjeHVE1E98kEKjUzBRMB0GA1UdDgQWBBRJcReofuu9
4PhERJD7xnFaGs2R3zAfBgNVHSMEGDAWgBRJcReofuu94PhERJD7xnFaGs2R3zAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIGVb5luq+/bL4WH7QfvY
vN8fiy+KrW6ZJZjguhI98xyFAiEA0zd9xSiqMBxqwzbKeKoh2KKD01z24GMqC+pZ
u0DFOMc=
-----END CERTIFICATE-----
`;

/** A token signed with Node's own crypto, independent of the Web Crypto path under test. */
function signed(alg: string, header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyObject): string {
  const input = `${b64(JSON.stringify({ alg, typ: "JWT", ...header }))}.${b64(JSON.stringify(payload))}`;
  const hash = `sha${alg.slice(2)}`;
  let signature: Buffer;
  if (alg.startsWith("RS")) signature = sign(hash, Buffer.from(input), key);
  else if (alg.startsWith("PS")) signature = sign(hash, Buffer.from(input), { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.slice(2)) / 8 });
  else if (alg.startsWith("ES")) signature = sign(hash, Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  else signature = sign(null, Buffer.from(input), key);
  return `${input}.${b64(signature)}`;
}

describe("decoding", () => {
  it("reads the header and claims, with or without a Bearer prefix and quotes", () => {
    for (const input of [EXAMPLE, `Bearer ${EXAMPLE}`, `Authorization: Bearer ${EXAMPLE}\n`, `"${EXAMPLE}"`]) {
      const decoded = decodeJwt(input);
      expect(decoded.header).toEqual({ alg: "HS256", typ: "JWT" });
      expect(decoded.payload).toEqual({ sub: "1234567890", name: "John Doe", iat: 1516239022 });
      expect(decoded.signature.length).toBe(32);
    }
  });

  it("says what is wrong with something that is not a JWT", () => {
    const problem = (input: string) => {
      try {
        decodeJwt(input);
      } catch (error) {
        return error instanceof JwtError ? error.message : String(error);
      }
      return "decoded";
    };
    expect(problem("")).toBe("Paste a token first.");
    expect(problem("abc")).toBe("This has 1 part, not three.");
    expect(problem("a.b")).toBe("This has 2 parts, not three.");
    expect(problem(`${b64("hello")}.${b64("{}")}.x`)).toBe("The header is not JSON.");
    expect(problem("e$J.a.b")).toBe("A part of this token is not base64url.");
  });

  it("reads only the header of an encrypted token", () => {
    const decoded = decodeJwt(`${b64('{"alg":"RSA-OAEP","enc":"A256GCM"}')}.key.iv.ciphertext.tag`);
    expect(decoded.kind).toBe("encrypted");
    expect(decoded.header.enc).toBe("A256GCM");
    expect(decoded.payload).toBeNull();
  });

  it("names the claims and turns dates into dates", () => {
    const now = 1_700_000_000;
    const rows = describeFields({ iss: "https://id.example", exp: now + 7200, aud: ["a", "b"], custom: { x: 1 } }, now, "payload");
    expect(rows).toEqual([
      { key: "iss", label: "Issuer", value: "https://id.example" },
      { key: "exp", label: "Expires", value: "2023-11-15 00:13:20Z (in 2 hours)" },
      { key: "aud", label: "Audience", value: "a, b" },
      { key: "custom", label: "custom", value: '{"x":1}' },
    ]);
    expect(timeState({ exp: now - 90, iat: now - 3690 }, now)).toEqual({ state: "expired", text: "Expired 1 minute ago." });
    expect(timeState({ exp: now + 3600, iat: now - 60 }, now).text).toBe("In date: it expires in 1 hour, of a lifetime of 1 hour.");
    expect(timeState({ nbf: now + 86400 * 3 }, now).state).toBe("early");
    expect(timeState({ sub: "x" }, now).state).toBe("no-expiry");
  });

  it("warns about unsigned tokens, millisecond dates and secrets in the payload", () => {
    const token = `${b64('{"alg":"none"}')}.${b64(JSON.stringify({ exp: 1_700_000_000_000, password: "hunter2" }))}.`;
    const warnings = tokenWarnings(decodeJwt(token));
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('"none"');
    expect(warnings[1]).toContain("milliseconds");
    expect(warnings[2]).toContain('"password"');
  });
});

describe("verification", () => {
  it("checks HMAC signatures against a secret, as text or as base64", async () => {
    const decoded = decodeJwt(EXAMPLE);
    expect((await verifyJwt(decoded, "your-256-bit-secret")).state).toBe("valid");
    expect((await verifyJwt(decoded, "wrong")).state).toBe("invalid");
    expect((await verifyJwt(decoded, b64("your-256-bit-secret"), "base64")).state).toBe("valid");
    expect((await verifyJwt(decoded, "")).state).toBe("bad-key");
  });

  it("checks RS, PS and ES signatures against PEM, PKCS #1 and JWK keys", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const payload = { sub: "someone" };
    for (const alg of ["RS256", "RS384", "RS512", "PS256", "PS512"]) {
      const decoded = decodeJwt(signed(alg, {}, payload, rsa.privateKey));
      expect((await verifyJwt(decoded, rsa.publicKey.export({ type: "spki", format: "pem" }).toString())).state, alg).toBe("valid");
      expect((await verifyJwt(decoded, rsa.publicKey.export({ type: "pkcs1", format: "pem" }).toString())).state, alg).toBe("valid");
      expect((await verifyJwt(decoded, JSON.stringify({ ...rsa.publicKey.export({ format: "jwk" }), alg, use: "sig" }))).state, alg).toBe("valid");
    }
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect((await verifyJwt(decodeJwt(signed("RS256", {}, payload, rsa.privateKey)), other.publicKey.export({ type: "spki", format: "pem" }).toString())).state).toBe("invalid");

    for (const [alg, curve] of [
      ["ES256", "P-256"],
      ["ES384", "P-384"],
      ["ES512", "P-521"],
    ]) {
      const ec = generateKeyPairSync("ec", { namedCurve: curve });
      const decoded = decodeJwt(signed(alg, {}, payload, ec.privateKey));
      expect((await verifyJwt(decoded, ec.publicKey.export({ type: "spki", format: "pem" }).toString())).state, alg).toBe("valid");
    }
  });

  it("picks the right key from a JWK set by its key ID", async () => {
    const one = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const two = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const set = JSON.stringify({ keys: [{ ...one.publicKey.export({ format: "jwk" }), kid: "one" }, { ...two.publicKey.export({ format: "jwk" }), kid: "two" }] });
    expect((await verifyJwt(decodeJwt(signed("RS256", { kid: "two" }, {}, two.privateKey)), set)).state).toBe("valid");
    const missing = await verifyJwt(decodeJwt(signed("RS256", { kid: "three" }, {}, two.privateKey)), set);
    expect(missing.state).toBe("bad-key");
    expect(missing.text).toContain('"three"');
  });

  it("checks a signature against a certificate's key", async () => {
    expect((await verifyJwt(decodeJwt(CERTIFICATE_TOKEN), CERTIFICATE)).state).toBe("valid");
  });

  it("checks Ed25519 signatures", async () => {
    const ed = generateKeyPairSync("ed25519");
    const decoded = decodeJwt(signed("EdDSA", {}, { sub: "x" }, ed.privateKey));
    expect((await verifyJwt(decoded, ed.publicKey.export({ type: "spki", format: "pem" }).toString())).state).toBe("valid");
  });

  it("refuses a private key, an unsigned token and algorithms a browser lacks", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = decodeJwt(signed("RS256", {}, {}, rsa.privateKey));
    const refused = await verifyJwt(token, rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(refused.state).toBe("bad-key");
    expect(refused.text).toContain("private key");
    expect((await verifyJwt(decodeJwt(`${b64('{"alg":"none"}')}.${b64("{}")}.`), "x")).state).toBe("invalid");
    expect((await verifyJwt(decodeJwt(`${b64('{"alg":"ES256K"}')}.${b64("{}")}.AA`), "x")).state).toBe("unsupported");
  });

  it("wraps a PKCS #1 key in the structure Web Crypto imports", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const pkcs1 = rsa.publicKey.export({ type: "pkcs1", format: "der" });
    expect(Buffer.from(rsaSpki(new Uint8Array(pkcs1))).equals(rsa.publicKey.export({ type: "spki", format: "der" }))).toBe(true);
  });
});
