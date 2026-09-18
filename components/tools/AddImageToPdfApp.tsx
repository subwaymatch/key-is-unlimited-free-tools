"use client";

import { useCallback, useMemo, useState } from "react";

import { imageMimeType } from "@/lib/chosenFile";
import { drawImage, encodeCanvas, IMAGE_ACCEPT, looksLikeImage } from "@/lib/images/canvas";
import { CORNERS, type Corner } from "@/lib/images/edit";
import { readPicture } from "@/lib/images/run";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { rangeSyntaxProblem } from "@/lib/pdf/ranges";
import { DEFAULT_STAMP_IMAGE_SETTINGS, MARK_SIZES, PAGE_CHOICES, stampImageOnPages, type PageChoice, type StampImageSettings, type StampPicture } from "@/lib/pdf/stampImage";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("add-image-to-pdf");

/** A logo larger than this is not a logo, and a picture this size embeds on every page. */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024;

function isStampSettings(value: unknown): value is StampImageSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StampImageSettings>;
  return (
    CORNERS.some((corner) => corner.id === candidate.corner) &&
    typeof candidate.size === "number" &&
    typeof candidate.margin === "number" &&
    typeof candidate.opacity === "number" &&
    PAGE_CHOICES.some((choice) => choice.id === candidate.pages) &&
    typeof candidate.ranges === "string"
  );
}

interface RunSettings extends StampImageSettings {
  picture: File | null;
}

/** The chosen picture as bytes pdf-lib embeds: JPEG and PNG as they are, anything else drawn to a PNG. */
async function preparePicture(file: File): Promise<StampPicture> {
  const image = await readPicture(file);
  try {
    const size = { width: image.width, height: image.height };
    const mime = imageMimeType(file);
    if (mime) return { bytes: new Uint8Array(await file.arrayBuffer()), mime, ...size };
    const canvas = drawImage(image, size, null);
    const blob = await encodeCanvas(canvas, "image/png");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", ...size };
  } finally {
    image.close();
  }
}

/** A logo, a signature or a stamp on a PDF's pages. */
export function AddImageToPdfApp() {
  const [settings, setSettings] = useState<StampImageSettings>(DEFAULT_STAMP_IMAGE_SETTINGS);
  const [picture, setPicture] = useState<File | null>(null);
  useStoredSettings(storageKey("settings", "add-image-to-pdf"), settings, setSettings, isStampSettings);

  const choosePicture = useCallback((file: File) => setPicture(file), []);
  const pictureProblem = picture && !looksLikeImage(picture) ? "That is not a picture. Choose a PNG, JPEG or WebP." : picture && picture.size > MAX_PICTURE_BYTES ? "That picture is too large for a stamp; choose one under 20 MB." : null;
  const rangesProblem = settings.pages === "ranges" ? (settings.ranges.trim() === "" ? "Type the pages to stamp." : rangeSyntaxProblem(settings.ranges)) : null;

  const queue = useMemo<PlainQueueOptions<RunSettings>>(
    () => ({
      key: "add-image-to-pdf",
      settings: { ...settings, picture },
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        if (!current.picture) throw new PlainError("No picture was chosen.", "Choose the picture to add in the panel above, then add the PDF again.");
        report("Reading the picture...", null);
        const prepared = await preparePicture(current.picture);
        report("Opening...", null);
        const source = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(source)];
        report("Stamping...", null);
        const { bytes, stamped } = await stampImageOnPages(source, prepared, current);
        const corner = CORNERS.find((entry) => entry.id === current.corner)?.label.toLowerCase() ?? current.corner;
        return {
          facts,
          outputs: [{ label: "With the picture", fileName: pdfName(file, "-stamped"), blob: pdfBlob(bytes), kind: "pdf", note: `${current.picture.name} at the ${corner} of ${stamped} ${stamped === 1 ? "page" : "pages"}` }],
        };
      },
    }),
    [settings, picture],
  );

  const toolSettings: PlainSettings = {
    title: "Picture & placement",
    defaultOpen: true,
    invalid: () => (!picture ? "Choose a picture above before adding a PDF." : pictureProblem ?? rangesProblem),
    summary: () => `${picture?.name ?? "no picture yet"}, ${CORNERS.find((entry) => entry.id === settings.corner)?.label.toLowerCase()}, ${PAGE_CHOICES.find((choice) => choice.id === settings.pages)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The picture</legend>
          <FileField id="add-image-to-pdf-picture" accept={IMAGE_ACCEPT} chosen={picture?.name ?? null} onChoose={choosePicture} onClear={() => setPicture(null)} error={pictureProblem} note="A PNG with a transparent background sits best on a page. A JPEG is placed as it is; any other format is redrawn as PNG." />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Where on the page</legend>
          <RadioCards aria-label="Where on the page" value={settings.corner} onValueChange={(corner) => setSettings((previous) => ({ ...previous, corner: corner as Corner }))} options={CORNERS.map((entry) => ({ value: entry.id, label: entry.label }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards aria-label="Size" value={String(settings.size)} onValueChange={(value) => setSettings((previous) => ({ ...previous, size: Number(value) }))} options={MARK_SIZES.map((entry) => ({ value: String(entry.value), label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Opacity</legend>
          <RadioCards
            aria-label="Opacity"
            value={String(settings.opacity)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, opacity: Number(value) }))}
            options={[
              { value: "1", label: "Solid", blurb: "As the picture is" },
              { value: "0.6", label: "Half", blurb: "The page shows through" },
              { value: "0.3", label: "Faint", blurb: "A watermark" },
            ]}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Which pages</legend>
          <RadioCards aria-label="Which pages" value={settings.pages} onValueChange={(pages) => setSettings((previous) => ({ ...previous, pages: pages as PageChoice }))} options={PAGE_CHOICES.map((choice) => ({ value: choice.id, label: choice.label, blurb: choice.blurb }))} columns={2} />
          {settings.pages === "ranges" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Pages</span>
                <input type="text" value={settings.ranges} placeholder="1, 3-5, 8" spellCheck={false} aria-invalid={rangesProblem !== null} onChange={(event) => setSettings((previous) => ({ ...previous, ranges: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
              </label>
              {rangesProblem && settings.ranges.trim() !== "" && <p className={styles.warning}>{rangesProblem}</p>}
            </div>
          )}
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Choose a picture - a logo, a scanned signature, a stamp - and drop PDFs: each comes back with it placed at the corner you chose on the pages you chose, at a size and opacity you set. A signature on the last page, a letterhead on the first, a logo on every one. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Stamping"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: picture ? `${picture.name} is placed on each as it lands` : "Choose the picture above before adding PDFs" }}
      note="The picture is scaled to a share of the page's width as the page is shown, and placed with a small margin from the edges, on a page stored sideways as much as on an upright one. It is drawn over the page's content once, as an image the PDF carries, so it prints and shows in every viewer; it is not a form field and not an annotation, and cannot be moved afterwards. The pages themselves are copied untouched."
    />
  );
}
