"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SITE_NAME } from "@/lib/site";
import { liveToolsInDisplayOrder, toolPath } from "@/lib/tools";

import styles from "./SiteHeader.module.css";

/*
 * Wordmark plus every live tool, in the same order the index shows them.
 *
 * While the list is short these are plain links, which need no menu to open.
 * Below 640 px the row becomes a single horizontally scrollable strip rather
 * than wrapping to three lines and pushing the tool itself off the screen.
 * Once the catalogue outgrows one row this becomes a Base UI Navigation Menu
 * grouped by category, with a Drawer on narrow screens (step 3 of the sequence
 * in section 7.9 of the plan). The markup below is the fallback that behaviour
 * degrades to, so it is worth keeping honest.
 *
 * It is a client component for one reason: the current tool should look
 * current. `aria-current="page"` is what a screen reader announces, and the
 * style is the same fact for everyone else.
 */
export function SiteHeader() {
  const tools = liveToolsInDisplayOrder();
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          {SITE_NAME}
        </Link>

        <nav aria-label="Tools" className={styles.nav}>
          <ul className={styles.list}>
            {tools.map((tool) => {
              const path = toolPath(tool);
              const isCurrent = pathname === path;
              return (
                <li key={tool.slug}>
                  <Link
                    href={path}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`${styles.link} ${isCurrent ? styles.linkCurrent : ""}`}
                  >
                    {tool.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
