"use client";

import { useMemo, useState } from "react";

import { encodeCanvas, rejectNonImage } from "@/lib/images/canvas";
import { DPI, drawPhoto, drawSheet, mmToPixels, PHOTO_SPECS, setJpegDpi, SHEET_SPECS, sheetLayout } from "@/lib/images/passport";
import { readPicture } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainOutputSpec, PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("passport-photo");

interface PassportSettings {
  photo: string;
  sheet: string;
}

function isPassportSettings(value: unknown): value is PassportSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PassportSettings>;
  return PHOTO_SPECS.some((spec) => spec.id === candidate.photo) && SHEET_SPECS.some((spec) => spec.id === candidate.sheet);
}

async function jpegAt300(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const blob = await encodeCanvas(canvas, "image/jpeg", 0.92);
  return setJpegDpi(new Uint8Array(await blob.arrayBuffer()), DPI);
}

/** A photo cut to a passport or visa size and repeated across a print or a sheet of paper. */
export function PassportPhotoApp() {
  const [settings, setSettings] = useState<PassportSettings>({ photo: "35x45", sheet: "4x6" });
  useStoredSettings(storageKey("settings", "passport-photo"), settings, setSettings, isPassportSettings);

  const queue = useMemo<PlainQueueOptions<PassportSettings>>(
    () => ({
      key: "passport-photo",
      settings,
      preview: true,
      reject: rejectNonImage,
      run: async (file, current, report) => {
        const photo = PHOTO_SPECS.find((spec) => spec.id === current.photo)!;
        const sheet = SHEET_SPECS.find((spec) => spec.id === current.sheet)!;
        report("Opening the picture...", null);
        const image = await readPicture(file);
        try {
          report("Cutting the photo...", null);
          const single = drawPhoto(image, photo);
          const layout = sheetLayout(sheet, photo);
          report("Laying out the sheet...", null);
          const sheetCanvas = drawSheet(single, layout);
          const sheetBytes = await jpegAt300(sheetCanvas);
          const singleBytes = await jpegAt300(single);
          const stem = fileStem(file.name, "photo");
          const outputs: PlainOutputSpec[] = [
            { label: `${layout.cells.length} photos on a ${sheet.label}`, fileName: `${stem}-passport-${sheet.id}.jpg`, blob: new Blob([sheetBytes as BlobPart], { type: "image/jpeg" }), kind: "image", note: `${layout.sheet.width}x${layout.sheet.height} at ${DPI} dpi` },
          ];
          if (sheet.id !== "4x6") {
            report("Writing the PDF...", null);
            const { PDFDocument } = await import("pdf-lib");
            const pdf = await PDFDocument.create();
            const points = (pixels: number) => (pixels / DPI) * 72;
            const page = pdf.addPage([points(layout.sheet.width), points(layout.sheet.height)]);
            const embedded = await pdf.embedJpg(sheetBytes);
            page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
            outputs.push({ label: "The same sheet as a PDF", fileName: `${stem}-passport-${sheet.id}.pdf`, blob: new Blob([(await pdf.save()) as BlobPart], { type: "application/pdf" }), kind: "pdf", note: "Print at 100%, or Actual size: never Fit to page" });
          }
          outputs.push({ label: `One photo, ${photo.label}`, fileName: `${stem}-passport-${photo.id}.jpg`, blob: new Blob([singleBytes as BlobPart], { type: "image/jpeg" }), kind: "image", note: `${mmToPixels(photo.width)}x${mmToPixels(photo.height)} at ${DPI} dpi, for an online application` });
          return {
            facts: [`${image.width}x${image.height}`],
            notes: [
              `${layout.cells.length} photos of ${photo.label} in ${layout.rows} ${layout.rows === 1 ? "row" : "rows"} of ${layout.columns}, with grey lines to cut along.${sheet.id === "4x6" ? " Order it as a 4 x 6 in (10 x 15 cm) print, without borders or cropping to fit." : ""}`,
              "Check the rules for your document before printing: most want the head to fill about 70 to 80% of the photo's height, a plain light background and no shadows. This cuts the shape from the middle of your picture, a little above centre, so crop it close first if your head is small in it.",
            ],
            outputs,
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const photo = PHOTO_SPECS.find((spec) => spec.id === settings.photo)!;
  const sheet = SHEET_SPECS.find((spec) => spec.id === settings.sheet)!;
  const toolSettings: PlainSettings = {
    title: "Photo size & sheet",
    defaultOpen: true,
    summary: () => `${photo.label} on ${sheet.label.replace(/ paper$/, "")}, ${sheetLayout(sheet, photo).cells.length} to a sheet`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Photo size</legend>
          <RadioCards aria-label="Photo size" value={settings.photo} onValueChange={(value) => setSettings((previous) => ({ ...previous, photo: value }))} options={PHOTO_SPECS.map((spec) => ({ value: spec.id, label: spec.label, blurb: spec.blurb }))} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Printed on</legend>
          <RadioCards aria-label="Printed on" value={settings.sheet} onValueChange={(value) => setSettings((previous) => ({ ...previous, sheet: value }))} options={SHEET_SPECS.map((spec) => ({ value: spec.id, label: spec.label, blurb: spec.blurb }))} columns={3} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a portrait taken against a plain wall and get a sheet of passport or visa photos to print: 35 x 45 mm, 2 x 2 in and other sizes, laid out on a 4 x 6 in photo print that costs pennies at a kiosk, or on A4 or Letter paper, with lines to cut along. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Laying out"
      dropZone={{ accept: "image/*,.jpg,.jpeg,.png,.webp,.heic", inputLabel: "Choose a photo", headline: "Drop a portrait here", subhead: "Laid out as it lands - choose the size above" }}
      note="Everything is drawn at 300 dpi, the resolution photo printers and passport offices expect, and the JPEG says so, so it prints at its true size. On paper, print the PDF at 100% or Actual size; Fit to page shrinks every photo. The layout packs in as many as the sheet holds: eight 35 x 45 mm photos or six 2 x 2 in photos on a 4 x 6 print. This lays photos out; it does not check that a photo meets a country's rules."
    />
  );
}
