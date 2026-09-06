import Link from "next/link";

import { PROMISE, PROMISE_QUALIFIER, SITE_NAME } from "@/lib/site";
import { CATEGORY_LABELS, liveToolsByCategory, toolPath } from "@/lib/tools";

import styles from "./SiteFooter.module.css";

/*
 * Every live tool, as ordinary anchors in the server-rendered HTML.
 *
 * This is the list that does not depend on hydration: if the header menu ever
 * fails to open, or a crawler ignores JavaScript entirely, the whole catalogue
 * is still reachable from every page.
 */
export function SiteFooter() {
  const groups = liveToolsByCategory();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav aria-label="All tools" className={styles.groups}>
          {groups.map(({ category, tools }) => (
            <section key={category}>
              <h2 className={styles.groupTitle}>{CATEGORY_LABELS[category]}</h2>
              <ul className={styles.list}>
                {tools.map((tool) => (
                  <li key={tool.slug}>
                    <Link href={toolPath(tool)} className={styles.link}>
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <p className={styles.promise}>
          {PROMISE} {PROMISE_QUALIFIER}
        </p>
        <p className={styles.privacy}>
          {SITE_NAME} runs entirely in your browser. Your files are never uploaded.
        </p>
      </div>
    </footer>
  );
}
