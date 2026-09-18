"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, isIdentityOrder, loadPdf, pagesInOrder, reversedOrder, typedOrder } from "@/lib/pdf/pages";
import { pageIndices, parsePageRanges, rangeSyntaxProblem } from "@/lib/pdf/ranges";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("reorder-pdf-pages");

type OrderMode = "reverse" | "typed";

interface OrderSettings {
  mode: OrderMode;
  order: string;
}

function isOrderSettings(value: unknown): value is OrderSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OrderSettings>;
  return (candidate.mode === "reverse" || candidate.mode === "typed") && typeof candidate.order === "string";
}

const MODE_OPTIONS = [
  { value: "reverse", label: "Reverse the pages", blurb: "Last page first: a scan fed in backwards" },
  { value: "typed", label: "The order I type", blurb: "3, 1, 2 or 5-8, 1-4: the pages named go first, the rest follow" },
];

/** Pages put in another order. */
export function ReorderPdfPagesApp() {
  const [settings, setSettings] = useState<OrderSettings>({ mode: "reverse", order: "" });
  useStoredSettings(storageKey("settings", "reorder-pdf-pages"), settings, setSettings, isOrderSettings);

  const empty = settings.mode === "typed" && settings.order.trim() === "";
  const unreadable = settings.mode === "typed" ? rangeSyntaxProblem(settings.order) : null;

  const queue = useMemo<PlainQueueOptions<OrderSettings>>(
    () => ({
      key: "reorder-pdf-pages",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        const notes: string[] = [];
        let order: number[];
        if (current.mode === "reverse") {
          order = reversedOrder(count);
        } else {
          const parsed = parsePageRanges(current.order, count);
          if (parsed.ranges.length === 0) {
            throw new PlainError("No pages could be read from the order.", parsed.problems.join(" ") || "Type pages or ranges such as 3, 1, 2 in the panel.");
          }
          notes.push(...parsed.problems);
          const typed = typedOrder(count, pageIndices(parsed.ranges));
          order = typed.order;
          if (typed.appended > 0) notes.push(`The ${typed.appended} ${typed.appended === 1 ? "page" : "pages"} not named ${typed.appended === 1 ? "follows" : "follow"} in ${typed.appended === 1 ? "its" : "their"} own order.`);
        }
        if (isIdentityOrder(order)) {
          return { facts, notes, outputs: [], nothing: { message: "That is the order the pages are already in.", hint: count === 1 ? "A one-page document has only one order." : "Nothing would move." } };
        }
        report("Writing...", null);
        const bytes = await pagesInOrder(document, order);
        return {
          facts,
          notes,
          outputs: [{ label: current.mode === "reverse" ? "Reversed" : "Reordered", fileName: pdfName(file, current.mode === "reverse" ? "-reversed" : "-reordered"), blob: pdfBlob(bytes), kind: "pdf", note: `Pages now run ${order.slice(0, 8).map((index) => index + 1).join(", ")}${order.length > 8 ? ", ..." : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "New order",
    defaultOpen: true,
    invalid: () => (empty ? "Type the order before adding a PDF." : unreadable),
    summary: () => (settings.mode === "reverse" ? "reversed" : settings.order.trim() || "no order yet"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Order</legend>
        <RadioCards aria-label="Order" value={settings.mode} onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as OrderMode }))} options={MODE_OPTIONS} columns={2} />
        {settings.mode === "typed" && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Pages, in the order they should come</span>
              <input type="text" value={settings.order} placeholder="3, 1, 2" aria-invalid={empty || unreadable !== null} onChange={(event) => setSettings((previous) => ({ ...previous, order: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
            </label>
            <p className={styles.panelNote}>Pages are numbered from 1; ranges such as 5-8 work too. Pages you do not name follow, in their own order, so &quot;7&quot; alone moves page 7 to the front.</p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get its pages back in another order: reversed, for a scan that went through backwards, or in the order you type, with the pages you do not name following in their own. Nothing is re-drawn, and nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Reordering"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: unreadable ?? "Reordered as they land - choose how above" }}
      note="The pages are copied with their fonts, images and links, and the document keeps its title and author; bookmarks do not carry over, since they point at page numbers that have just changed. A page named twice comes out once, and a page past the end is skipped with a note."
    />
  );
}
