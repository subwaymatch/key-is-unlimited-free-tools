import Link from "next/link";

import { SITE_NAME } from "@/lib/site";
import { liveTools, toolPath } from "@/lib/tools";

import styles from "./SiteHeader.module.css";

/*
 * Wordmark plus every live tool.
 *
 * While the list is short these are plain links, which need no JavaScript and
 * no menu to open. Once the catalogue outgrows a single row this becomes a Base
 * UI Navigation Menu grouped by category, with a Drawer on narrow screens (step
 * 3 of the sequence in section 7.9 of the plan). The markup below is the
 * fallback that behaviour degrades to, so it is worth keeping honest.
 */
export function SiteHeader() {
  const tools = liveTools();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          {SITE_NAME}
        </Link>

        <nav aria-label="Tools">
          <ul className={styles.list}>
            {tools.map((tool) => (
              <li key={tool.slug}>
                <Link href={toolPath(tool)} className={styles.link}>
                  {tool.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
