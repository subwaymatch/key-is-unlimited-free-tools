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
 *
 * Navy in both colour schemes: the page ends on something solid, and the mark
 * was drawn to sit on a dark ground.
 */
export function SiteFooter() {
  const groups = liveToolsByCategory();
  const count = groups.reduce((total, group) => total + group.tools.length, 0);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Link href="/" className={styles.wordmark}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" width={32} height={32} className={styles.mark} />
              {SITE_NAME}
            </Link>
            <p className={styles.promise}>{PROMISE}</p>
            <p className={styles.qualifier}>{PROMISE_QUALIFIER}</p>
          </div>

          <nav aria-label="All tools" className={styles.groups}>
            {groups.map(({ category, tools }) => (
              <section key={category} className={styles.group}>
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
        </div>

        <div className={styles.bottom}>
          <p className={styles.privacy}>
            {SITE_NAME} runs entirely in your browser. Your files are never uploaded.{" "}
            <Link href="/privacy" className={styles.privacyLink}>
              Privacy
            </Link>
          </p>
          <p className={styles.count}>
            {count} tools, all free, no account.
          </p>
        </div>
      </div>
    </footer>
  );
}
