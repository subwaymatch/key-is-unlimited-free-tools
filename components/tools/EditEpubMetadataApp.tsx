"use client";

import { unzipSync } from "fflate";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import { saveBlob } from "@/lib/download";
import { EpubError } from "@/lib/documents/epub";
import { readEpubInfo, writeEpub, type EpubInfo, type EpubMetadata } from "@/lib/documents/epubMetadata";
import { formatBytes } from "@/lib/format-utils";
import { requireTool } from "@/lib/tools";

import { DropZone } from "../DropZone";
import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { FileField } from "../ui/FileField";
import settings from "../Settings.module.css";
import styles from "./CreateQrCodeApp.module.css";

const tool = requireTool("edit-epub-metadata");

interface Loaded {
  file: File;
  bytes: Uint8Array;
  info: EpubInfo;
  coverUrl: string | null;
}

const FIELDS: { key: keyof EpubMetadata; label: string; hint?: string; wide?: boolean }[] = [
  { key: "title", label: "Title", wide: true },
  { key: "authors", label: "Authors", hint: "One per line", wide: true },
  { key: "series", label: "Series" },
  { key: "seriesIndex", label: "Number in the series" },
  { key: "language", label: "Language", hint: "A code: en, fr, pt-BR" },
  { key: "publisher", label: "Publisher" },
  { key: "date", label: "Date", hint: "2024, 2024-05 or 2024-05-17" },
  { key: "subjects", label: "Subjects", hint: "One per line" },
  { key: "description", label: "Description", wide: true },
];

/** An e-book's title, authors, series and cover changed, the book otherwise untouched. */
export function EditEpubMetadataApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<keyof EpubMetadata, string>>({ title: "", authors: "", series: "", seriesIndex: "", language: "", publisher: "", date: "", description: "", subjects: "" });
  const [cover, setCover] = useState<{ file: File; bytes: Uint8Array; url: string } | null>(null);

  useEffect(() => () => {
    if (loaded?.coverUrl) URL.revokeObjectURL(loaded.coverUrl);
  }, [loaded]);
  useEffect(() => () => {
    if (cover) URL.revokeObjectURL(cover.url);
  }, [cover]);

  const open = async (file: File) => {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const files = unzipSync(bytes);
      const info = readEpubInfo(files);
      const coverBytes = info.cover ? files[info.cover.path] : undefined;
      const coverUrl = coverBytes ? URL.createObjectURL(new Blob([coverBytes as BlobPart], { type: info.cover!.mediaType })) : null;
      const { metadata } = info;
      setForm({ ...metadata, authors: metadata.authors.join("\n"), subjects: metadata.subjects.join("\n") });
      setCover(null);
      setLoaded({ file, bytes, info, coverUrl });
    } catch (caught) {
      setLoaded(null);
      setError(caught instanceof EpubError ? caught.message : "This file could not be opened as an EPUB: it is not a readable ZIP archive with a package file.");
    }
  };

  const save = () => {
    if (!loaded) return;
    const list = (text: string) => text.split(/\r?\n|;/).map((entry) => entry.trim()).filter(Boolean);
    const metadata: EpubMetadata = { title: form.title.trim(), authors: list(form.authors), series: form.series.trim(), seriesIndex: form.seriesIndex.trim(), language: form.language.trim(), publisher: form.publisher.trim(), date: form.date.trim(), description: form.description.trim(), subjects: list(form.subjects) };
    const bytes = writeEpub(loaded.bytes, metadata, cover ? { bytes: cover.bytes, mediaType: cover.file.type || "image/jpeg" } : undefined);
    saveBlob(loaded.file.name, new Blob([bytes as BlobPart], { type: "application/epub+zip" }));
  };

  return (
    <ToolFrame
      tool={tool}
      lead="Drop an EPUB to fix what your e-reader shows: the title, the authors, the series and its number, the language, publisher, date, description and subjects, and the cover picture. Everything else in the book is left exactly as it was. Nothing is uploaded."
      footer={
        <PlainFootnote note="Only the details changed are rewritten in the book's package file; chapters, pictures, fonts and styles are copied across byte for byte. Series are written both the way calibre writes them and the way EPUB 3 does, which between them Apple Books, Kobo, KOReader and calibre read. The archive is rebuilt with its mimetype entry first and uncompressed, as the EPUB standard requires. A book with DRM can be edited, but its locked chapters stay locked." />
      }
    >
      <DropZone onFiles={(files) => void open(files[0])} compact={loaded !== null} warmsEngine={false} accept=".epub,application/epub+zip" inputLabel="Choose an EPUB" headline="Drop an EPUB here" subhead="Its details open below to edit" />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loaded && (
        <section className={styles.card}>
          <div className={styles.result}>
            <div>
              {loaded.coverUrl || cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover?.url ?? loaded.coverUrl!} alt="The cover" style={{ width: "100%", maxWidth: "15rem", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)" }} />
              ) : (
                <p className={styles.hint}>This book has no cover picture.</p>
              )}
              <p className={styles.hint}>
                {loaded.file.name}, {formatBytes(loaded.file.size)}, EPUB {loaded.info.version}
              </p>
              {loaded.info.cover && (
                <FileField
                  id="epub-cover"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  chosen={cover ? `New cover: ${cover.file.name}` : "Replace the cover"}
                  onChoose={async (file) => setCover({ file, bytes: new Uint8Array(await file.arrayBuffer()), url: URL.createObjectURL(file) })}
                  onClear={() => setCover(null)}
                  note="JPEG or PNG, ideally 1600 x 2560 pixels."
                />
              )}
            </div>
            <div>
              <div className={styles.fields} style={{ marginTop: 0 }}>
                {FIELDS.map((field) => (
                  <label key={field.key} style={field.wide ? { gridColumn: "1 / -1" } : undefined}>
                    <span className={styles.fieldLabel}>
                      {field.label}
                      {field.hint ? `, ${field.hint.toLowerCase()}` : ""}
                    </span>
                    {field.key === "description" || field.key === "authors" || field.key === "subjects" ? (
                      <textarea className={settings.textarea} style={{ marginTop: 0, maxWidth: "none", fontFamily: "var(--font-sans)" }} rows={field.key === "description" ? 5 : 3} value={form[field.key]} onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))} />
                    ) : (
                      <input className={styles.input} value={form[field.key]} onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))} />
                    )}
                  </label>
                ))}
              </div>
              <div className={styles.actions}>
                <Button variant="primary" onClick={save} disabled={form.title.trim() === ""}>
                  <Download aria-hidden="true" size={16} /> Save the EPUB
                </Button>
              </div>
              {form.title.trim() === "" && <p className={styles.warning}>Every EPUB needs a title.</p>}
            </div>
          </div>
        </section>
      )}
    </ToolFrame>
  );
}
