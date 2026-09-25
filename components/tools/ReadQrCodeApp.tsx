"use client";

import { useMemo } from "react";

import { describeSize, drawImage, fitLongestSide, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { readPicture } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import type { PlainOutputSpec, PlainQueueOptions } from "@/lib/plainQueue";
import { interpretQrText } from "@/lib/qr/content";
import { luminance, readQrCodesAtScales } from "@/lib/qr/detect";
import { ECC_RECOVERY } from "@/lib/qr/tables";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("read-qr-code");

/** Canvases past this on a side fail on some phones; a code this small in such a photo is unreadable anyway. */
const MAX_SIDE = 6000;

/** The QR codes in a picture, and what each one holds. */
export function ReadQrCodeApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "read-qr-code",
      settings: {},
      reject: rejectNonImage,
      preview: true,
      run: async (file, _settings, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        let gray: Uint8Array;
        let size: { width: number; height: number };
        try {
          size = fitLongestSide({ width: image.width, height: image.height }, MAX_SIDE);
          const canvas = drawImage(image, size, "#ffffff");
          const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
          gray = luminance(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height);
        } finally {
          image.close();
        }
        report("Looking for codes...", null);
        const codes = readQrCodesAtScales(gray, size.width, size.height);
        const facts = [describeSize({ width: image.width, height: image.height })];
        if (codes.length === 0) {
          return {
            facts,
            outputs: [],
            nothing: { message: "No QR code was found in this picture.", hint: "Crop closer to the code, or photograph it straight on, in focus and with the whole of it in frame, quiet border included." },
          };
        }
        const stem = fileStem(file.name, "picture");
        const outputs: PlainOutputSpec[] = [];
        const notes: string[] = [];
        facts.push(`Codes found: ${codes.length}`);
        codes.forEach((code, index) => {
          const meaning = interpretQrText(code.text);
          const number = codes.length > 1 ? ` ${index + 1}` : "";
          const shape = `version ${code.version}, level ${code.level} (${ECC_RECOVERY[code.level]} recoverable)${code.corrected > 0 ? `, ${code.corrected} damaged ${code.corrected === 1 ? "codeword" : "codewords"} repaired` : ""}${code.part ? `, part ${code.part.index} of ${code.part.total}` : ""}`;
          outputs.push({ label: `${meaning.label}${number}`, fileName: `${stem}-qr${codes.length > 1 ? `-${index + 1}` : ""}.txt`, blob: new Blob([code.text], { type: "text/plain;charset=utf-8" }), kind: "text", text: code.text, note: shape });
          for (const fact of meaning.facts) facts.push(codes.length > 1 ? fact.replace(/^([^:]+):/, `$1 (${index + 1}):`) : fact);
          notes.push(...meaning.warnings);
          if (code.mirrored) notes.push(`Code${number} was printed as a mirror image; it was read the other way round.`);
        });
        if (codes.length > 1) {
          const all = codes.map((code, index) => `${index + 1}\t${code.text.replace(/\r?\n/g, " ")}`).join("\n");
          outputs.push({ label: "All codes", fileName: `${stem}-qr-codes.txt`, blob: new Blob([`${all}\n`], { type: "text/plain;charset=utf-8" }), kind: "file", note: "One line each, numbered, tab-separated" });
        }
        return { facts, notes: [...new Set(notes)], outputs };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a screenshot or a photo with a QR code in it and see what the code says before you open anything: links with their real destination, Wi-Fi passwords, contact cards, two-factor secrets. Several codes in one picture are all read. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose pictures", headline: "Drop pictures with QR codes here", subhead: "Screenshots, photos and scans" }}
      note="The reader finds the three corner squares every QR code has, works out the grid from them, corrects for a code photographed at an angle, and lets the code's own error correction repair smudges and glare, up to 30% at level H. Codes printed light on dark or mirrored are read too. Links are only shown, never opened: check where one leads before you visit it, since a sticker over a genuine code is a common trick. Micro QR, Data Matrix and ordinary barcodes are not read."
    />
  );
}
