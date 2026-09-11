import type { Metadata } from "next";
import Link from "next/link";

import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { SITE_NAME } from "@/lib/site";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What key.is does and does not collect. Files are processed in your browser and never uploaded; the only third-party request is the ffmpeg engine itself.",
  alternates: { canonical: "/privacy" },
};

/*
 * The privacy page.
 *
 * A site whose entire pitch is "nothing is uploaded" had no page saying so in
 * a form anyone could check, while running an analytics beacon. This is that
 * page: what leaves the browser, what does not, and why the one request to a
 * third party exists.
 */
export default function Page() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Privacy</h1>
        <p className={styles.lead}>
          {SITE_NAME} converts files in your browser. Your files are never uploaded, and there is
          no account, no login and nothing to sign up for.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.heading}>Your files</h2>
        <p>
          Every conversion runs on your own device, through ffmpeg compiled to WebAssembly. A file
          you drop in is read by the page and handed to that engine; it is never sent anywhere,
          and no server ever sees it. There is no upload, so there is nothing to delete afterwards
          and no retention period to quote you.
        </p>
        <p>
          Large files are not even copied into memory: they are mounted and read on demand
          straight from disk, which is what lets videos far past the usual WebAssembly ceiling
          work at all.
        </p>
        <p>
          Finished files live in your browser tab until you download them or close it. Nothing is
          written to permanent storage on your device except the settings below.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What the browser stores</h2>
        <p>
          Two things, both in your browser and neither readable by us. The ffmpeg engine
          (@ffmpeg/ffmpeg {FFMPEG_VERSION}, core {CORE_VERSION}) is cached by the browser after
          its first download so later visits start immediately. Your tool settings - which output
          formats are ticked, the compression target, whether metadata is removed - are kept in
          local storage so a tool remembers how you left it. Clearing site data removes both.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Requests that do leave your browser</h2>
        <p>
          The page itself and its fonts are served from this site. Beyond that there is exactly
          one third-party request: the ~31 MB ffmpeg core, fetched once from the jsDelivr CDN. It
          is too large for this site&apos;s own asset hosting, which caps a single file at 25 MiB.
        </p>
        <p>
          Because that core runs with full access to whatever file you are converting, its bytes
          are checked against a SHA-256 digest pinned into this app before it is allowed to run.
          A CDN serving anything other than the exact build this site was tested against is
          refused rather than executed.
        </p>
        <p>
          The site uses Cloudflare Web Analytics, which counts page views and referrers without
          cookies and without building a profile of you or following you across sites. It records
          nothing about the files you convert, because nothing about them ever leaves the tab.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What there is none of</h2>
        <ul className={styles.list}>
          <li>No accounts, logins or email addresses.</li>
          <li>No advertising, and no advertising or tracking cookies.</li>
          <li>No file uploads, and so no copies of your files anywhere but your own device.</li>
          <li>No selling or sharing of anything, because there is nothing to sell or share.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Metadata in your outputs</h2>
        <p>
          Files carry more than picture and sound. A clip from a phone records the time it was
          taken, the model of the phone and often the GPS position of where you were standing. By
          default every tool here removes that from the file it produces; the &quot;Output
          options&quot; panel on each tool turns it back on if you want the tags kept. The{" "}
          <Link href="/remove-metadata" className={styles.link}>
            metadata remover
          </Link>{" "}
          does the same thing to a file you already have.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/" className={styles.link}>
          All tools
        </Link>
      </p>
    </main>
  );
}
