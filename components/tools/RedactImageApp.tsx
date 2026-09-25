"use client";

import { Download, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { saveBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format-utils";
import { canEncode, decodeImage, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { applyRedactions, boxAt, rectBetween, type RedactRect, type RedactStyle, type Redaction } from "@/lib/images/redact";
import { pictureName } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { requireTool } from "@/lib/tools";

import { DropZone } from "../DropZone";
import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import shared from "./CreateQrCodeApp.module.css";
import styles from "./RedactImageApp.module.css";

const tool = requireTool("redact-image");

/** Pixels past this are more than a tab can hold twice over, which the editor needs. */
const MAX_PIXELS = 40_000_000;

const STYLES: { value: RedactStyle; label: string; blurb: string }[] = [
  { value: "black", label: "Black box", blurb: "The safe choice for text: nothing under it survives" },
  { value: "pixelate", label: "Pixelate", blurb: "Coarse blocks; for faces and pictures" },
  { value: "blur", label: "Blur", blurb: "Smooth, from the same coarse blocks" },
];

interface Loaded {
  file: File;
  width: number;
  height: number;
  original: ImageData;
}

type Point = { x: number; y: number };

function isStyle(value: unknown): value is { style: RedactStyle } {
  return typeof value === "object" && value !== null && STYLES.some((option) => option.value === (value as { style?: unknown }).style);
}

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

/** Parts of a screenshot or photo covered for good, burned into the pixels and saved without metadata. */
export function RedactImageApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Redaction[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [preference, setPreference] = useState<{ style: RedactStyle }>({ style: "black" });
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useStoredSettings(storageKey("settings", "redact-image"), preference, setPreference, isStyle);

  const open = useCallback(async (file: File) => {
    setError(null);
    const rejection = rejectNonImage(file);
    if (rejection) {
      setError(`${rejection.message} ${rejection.hint}`);
      return;
    }
    try {
      const image = await decodeImage(file);
      try {
        if (image.width * image.height > MAX_PIXELS) throw new Error(`This picture is ${image.width} x ${image.height}, more than can be edited in a browser tab; scale it down first.`);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image.source, 0, 0);
        setLoaded({ file, width: image.width, height: image.height, original: context.getImageData(0, 0, image.width, image.height) });
        setBoxes([]);
        setSelected(null);
      } finally {
        image.close();
      }
    } catch (caught) {
      setLoaded(null);
      setError(caught instanceof Error && caught.message.includes("scale it down") ? caught.message : "The browser could not open this picture. Drop a PNG, JPEG, WebP or GIF.");
    }
  }, []);

  // A screenshot is usually on the clipboard: paste it anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void open(new File([file], file.name && file.name !== "image.png" ? file.name : "screenshot.png", { type: file.type }));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open]);

  // The picture as it will be saved: every box burned in.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    canvas.width = loaded.width;
    canvas.height = loaded.height;
    const pixels = new Uint8ClampedArray(loaded.original.data);
    applyRedactions(pixels, loaded.width, loaded.height, boxes);
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, loaded.width, loaded.height), 0, 0);
  }, [loaded, boxes]);

  const pointAt = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - bounds.left) / bounds.width) * loaded!.width, y: ((event.clientY - bounds.top) / bounds.height) * loaded!.height };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!loaded || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    setDrag({ start: point, end: point });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const end = pointAt(event);
    setDrag((previous) => (previous ? { ...previous, end } : previous));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || !loaded) return;
    const end = pointAt(event);
    setDrag(null);
    const rect = rectBetween(drag.start, end, loaded.width, loaded.height);
    if (rect) {
      setBoxes((previous) => [...previous, { ...rect, style: preference.style }]);
      setSelected(boxes.length);
      return;
    }
    // A click, not a drag: pick the box under it, or none.
    const hit = boxAt(boxes, end);
    setSelected(hit >= 0 ? hit : null);
  };

  const remove = (index: number) => {
    setBoxes((previous) => previous.filter((_, at) => at !== index));
    setSelected(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Delete" || event.key === "Backspace") && selected !== null) {
      event.preventDefault();
      remove(selected);
    } else if (event.key === "Escape") setSelected(null);
  };

  const chooseStyle = (style: RedactStyle) => {
    setPreference({ style });
    // Changing the style while a box is picked changes that box.
    if (selected !== null) setBoxes((previous) => previous.map((box, at) => (at === selected ? { ...box, style } : box)));
  };

  const mime = loaded ? (sameFormatMime(loaded.file) === "image/webp" && !canEncode("image/webp") ? "image/png" : sameFormatMime(loaded.file)) : "image/png";

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    setSaving(true);
    try {
      const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : 0.92);
      saveBlob(pictureName(loaded.file, mime, "-redacted"), blob);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const dragRect: RedactRect | null = drag && loaded ? rectBetween(drag.start, drag.end, loaded.width, loaded.height) : null;

  return (
    <ToolFrame
      tool={tool}
      lead="Drop or paste a screenshot or photo, drag boxes over what nobody else should see - names, addresses, account numbers, faces, messages - and save a copy with those parts gone for good. Nothing is uploaded."
      footer={
        <PlainFootnote note="The boxes are burned into the pixels: the saved picture has no layers and nothing under a box to uncover, and it carries none of the original's metadata - no location, camera, date or editing history. Pixelate and Blur keep only the average colour of coarse blocks, so no fine detail survives them, but for text a black box is the only choice that leaves nothing at all to guess from: the length of a blurred word can be enough to give it away. JPEG and WebP pictures are saved in their own format at high quality, everything else as PNG." />
      }
    >
      <DropZone onFiles={(files) => void open(files[0])} compact={loaded !== null} warmsEngine={false} accept={IMAGE_ACCEPT} inputLabel="Choose a picture" headline="Drop a picture here, or paste a screenshot" subhead="Ctrl+V or Cmd+V pastes from the clipboard" />
      {error && (
        <p className={shared.error} role="alert">
          {error}
        </p>
      )}
      {loaded && (
        <section className={shared.card} style={{ marginTop: "1rem" }}>
          <RadioCards aria-label="Cover with" value={preference.style} onValueChange={chooseStyle} options={STYLES} columns={3} />
          <div className={styles.toolbar}>
            <Button variant="primary" onClick={() => void save()} disabled={boxes.length === 0 || saving}>
              <Download aria-hidden="true" size={16} /> Save the picture
            </Button>
            <Button onClick={() => selected !== null && remove(selected)} disabled={selected === null}>
              <Trash2 aria-hidden="true" size={16} /> Remove the picked box
            </Button>
            <Button variant="ghost" onClick={() => remove(boxes.length - 1)} disabled={boxes.length === 0}>
              <Undo2 aria-hidden="true" size={16} /> Undo
            </Button>
            <Button variant="ghost" onClick={() => {
                setBoxes([]);
                setSelected(null);
              }} disabled={boxes.length === 0}>
              Clear all
            </Button>
          </div>
          <p className={shared.hint}>
            {boxes.length === 0 ? "Drag across the picture to cover a part of it." : `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"}. Click a box to pick it, then change its style or press Delete to remove it.`} {loaded.file.name}, {loaded.width} x {loaded.height}, {formatBytes(loaded.file.size)}; saved as {MIME_LABELS[mime]}.
          </p>
          <div className={styles.stageWrap}>
            <div
              className={styles.stage}
              role="application"
              aria-label="The picture: drag to cover a part of it"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={onKeyDown}
            >
              <canvas ref={canvasRef} width={loaded.width} height={loaded.height} />
              {boxes.map((box, index) => (
                <span key={index} className={`${styles.box} ${index === selected ? styles.selected : ""}`} style={{ left: percent(box.x, loaded.width), top: percent(box.y, loaded.height), width: percent(box.width, loaded.width), height: percent(box.height, loaded.height) }} />
              ))}
              {dragRect && <span className={styles.drawing} style={{ left: percent(dragRect.x, loaded.width), top: percent(dragRect.y, loaded.height), width: percent(dragRect.width, loaded.width), height: percent(dragRect.height, loaded.height) }} />}
            </div>
          </div>
        </section>
      )}
    </ToolFrame>
  );
}
