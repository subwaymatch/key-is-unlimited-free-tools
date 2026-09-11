import type { Metadata } from "next";
import Link from "next/link";

import { ToolIcon } from "@/components/ToolIcon";
import { SITE_NAME } from "@/lib/site";
import { liveToolsInDisplayOrder, toolPath } from "@/lib/tools";

import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

/*
 * A 404 that is worth landing on.
 *
 * The default Next.js page says "This page could not be found." under the
 * homepage's own title, which is both a dead end and a duplicate title in
 * search results. Someone who mistyped a URL is one click from what they came
 * for, so the page is the list of tools.
 *
 * Common aliases (/compress, /gif, /mp4, ...) never get here at all: they are
 * redirected by public/_redirects before the request reaches an asset.
 */
export default function NotFound() {
  const tools = liveToolsInDisplayOrder();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>There is no page at that address.</h1>
        <p className={styles.lead}>
          It may have been a typo, or a link that was never right. Everything {SITE_NAME} does is
          below.
        </p>
      </header>

      <ul className={styles.list}>
        {tools.map((tool) => (
          <li key={tool.slug}>
            <Link href={toolPath(tool)} className={styles.card}>
              <span className={styles.cardHead}>
                <ToolIcon name={tool.icon} className={styles.icon} />
                <span className={styles.name}>{tool.name}</span>
              </span>
              <span className={styles.tagline}>{tool.tagline}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
