"use client";

import { useMemo } from "react";

import { Asn1Error, chainGaps, describeCertificate, readCertificates, toPem, validity } from "@/lib/crypto/x509";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("inspect-certificate");

/** Past this a file is not a certificate. */
const MAX_BYTES = 4 * 1024 * 1024;

/** What a certificate or a signing request says, in words, with its fingerprints, and in the other encoding. */
export function InspectCertificateApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "inspect-certificate",
      settings: {},
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no certificate in it." };
        if (file.size > MAX_BYTES) return { message: "This file is too large to be a certificate.", hint: "Certificates are a few kilobytes; a bundle of hundreds is still well under a megabyte." };
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "p12" || extension === "pfx") return { message: "This is a PKCS #12 bundle, sealed with a password.", hint: "Export the certificate alone as a .pem, .crt or .cer and drop that." };
        return null;
      },
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let read;
        try {
          read = readCertificates(bytes);
        } catch (error) {
          throw new PlainError("This is not a certificate this can read.", error instanceof Asn1Error ? error.message : error instanceof Error ? error.message : String(error));
        }
        const { certificates, others, pem } = read;
        const privateKeys = others.filter((label) => label.includes("PRIVATE KEY"));
        if (certificates.length === 0) {
          throw new PlainError(privateKeys.length > 0 ? "This file holds a private key, not a certificate." : "No certificate was found in this file.", privateKeys.length > 0 ? "Keep it private: a private key should never be sent to anyone or pasted into a website. Nothing here reads it." : `It has PEM blocks of other kinds: ${others.join(", ") || "none"}.`);
        }
        const now = new Date();
        const first = certificates[0];
        const state = first.kind === "certificate" ? validity(first, now) : null;
        const facts = [
          `${certificates.length === 1 ? (first.kind === "request" ? "signing request" : "certificate") : `${certificates.length} certificates`}, ${pem ? "PEM" : "DER"}`,
          `Subject: ${first.commonName}`,
          ...(first.kind === "certificate" ? [`Issuer: ${first.subject === first.issuer ? "itself (self-signed)" : first.issuer}`, `Status: ${state!.text}`] : []),
          ...(first.altNames.length > 0 ? [`Covers: ${first.altNames.map((name) => name.replace(/^DNS:/, "")).slice(0, 6).join(", ")}${first.altNames.length > 6 ? ` and ${first.altNames.length - 6} more` : ""}`] : []),
          `Key: ${first.key}`,
          `SHA-256: ${first.sha256}`,
        ];
        const notes: string[] = [];
        if (state?.state === "expired") notes.push(`This certificate has expired: browsers and apps refuse it. It ran out on ${first.notAfter!.toUTCString()}.`);
        if (state?.state === "future") notes.push("This certificate is not valid yet; a device whose clock is wrong can make a good certificate look like this.");
        if (/SHA-1|MD5/.test(first.signature) && first.subject !== first.issuer) notes.push(`It is signed with ${first.signature}, which current browsers no longer trust.`);
        const gaps = chainGaps(certificates);
        if (certificates.length > 1) notes.push(gaps.length === 0 ? "Each certificate in the file is issued by the one after it, as a chain should be." : `The chain is out of order or broken after certificate ${gaps.map((gap) => gap + 1).join(", ")}: the next one is not its issuer.`);
        if (privateKeys.length > 0) notes.push("The file also holds a private key. Keep it private; nothing here reads it or includes it below.");
        const text = `${certificates.map((certificate, index) => `${certificates.length > 1 ? `Certificate ${index + 1}\n${"-".repeat(13)}\n` : ""}${describeCertificate(certificate, now)}`).join("\n\n")}\n`;
        const stem = fileStem(file.name, "certificate");
        const outputs: PlainOutputSpec[] = [{ label: "Report", fileName: `${stem}-report.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), kind: "file", note: "Every field, in words" }];
        if (pem && certificates.length === 1) outputs.push({ label: "As DER", fileName: `${stem}.${first.kind === "request" ? "der" : "cer"}`, blob: new Blob([first.der as BlobPart], { type: "application/pkix-cert" }), kind: "file", note: "The binary form Windows and Java often ask for" });
        if (!pem) outputs.push({ label: "As PEM", fileName: `${stem}.pem`, blob: new Blob([toPem(first.der, first.kind === "request" ? "CERTIFICATE REQUEST" : "CERTIFICATE")], { type: "application/x-pem-file" }), kind: "file", note: "The text form web servers and most tools read" });
        return { facts, notes, outputs };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a certificate - a .pem, .crt, .cer or .der, a chain, or a signing request - and see what it says: who it is for and who issued it, the names it covers, when it expires, its key and its fingerprints, with the other encoding to download. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: ".pem,.crt,.cer,.der,.csr,.req,.cert,application/x-x509-ca-cert,application/pkix-cert", inputLabel: "Choose certificate files", headline: "Drop certificates here", subhead: "Read as they land" }}
      note="The certificate is read field by field from its ASN.1, the fingerprints worked out from its bytes, and every extension a browser cares about named: the names covered, key usage, whether it may sign other certificates, the validation policy, and where its issuer and revocation status are published. Nothing is verified: this shows what a certificate claims, not whether its signature holds, which only its issuer's certificate can say."
    />
  );
}
