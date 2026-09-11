import type { ReactNode } from "react";

import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { formatBytes } from "@/lib/format-utils";
import type { ToolMeta } from "@/lib/tools";

import styles from "./ToolFrame.module.css";

/** Files this large rely on the WORKERFS mount path rather than an in-memory copy. */
const LARGE_FILE_BYTES = 2 * 1024 ** 3;

interface ToolFrameProps {
  tool: ToolMeta;
  /** The paragraph under the title: the tool's promise in its own terms. */
  lead: ReactNode;
  children: ReactNode;
  /** The fine print under the tool, when it has any. */
  footer?: ReactNode;
}

/**
 * The page around any tool: title, lead, the tool itself, fine print.
 *
 * Shared by the queue-driven tools and the ones with a shape of their own, so
 * every tool page has the same width, the same header and the same footer
 * whatever is in the middle.
 */
export function ToolFrame({ tool, lead, children, footer }: ToolFrameProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{tool.name}</h1>
        <p className={styles.tagline}>{lead}</p>
      </header>

      <div className={styles.stack}>{children}</div>

      {footer && <footer className={styles.footer}>{footer}</footer>}
    </main>
  );
}

interface EngineFootnoteProps {
  /** A note for anything this tool has to say about its limits. */
  note?: ReactNode;
  /** Size of the largest file seen, for the line about big files. */
  largestFile?: number;
}

/** The fine print every ffmpeg-backed tool ends with. */
export function EngineFootnote({ note, largestFile = 0 }: EngineFootnoteProps) {
  return (
    <>
      {note && <p>{note}</p>}
      <p>
        Your files never leave this device. Decoding happens locally with ffmpeg compiled to
        WebAssembly (@ffmpeg/ffmpeg {FFMPEG_VERSION}, core {CORE_VERSION}).
      </p>
      <p>
        Large files are mounted and read on demand rather than loaded into memory, which is what
        allows videos well past the usual ~2 GB WebAssembly ceiling
        {largestFile > LARGE_FILE_BYTES && ` (largest so far: ${formatBytes(largestFile)})`}.
      </p>
    </>
  );
}
