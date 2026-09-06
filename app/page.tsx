import Link from "next/link";

import { PROMISE, PROMISE_QUALIFIER, PROMISE_REASON } from "@/lib/site";
import { CATEGORY_LABELS, liveToolsByCategory, toolPath } from "@/lib/tools";

import styles from "./page.module.css";

/*
 * The index of every live tool.
 *
 * This is the front page from the first tool onwards, not from the second: an
 * index with one entry is honest, and moving the tool off "/" later would throw
 * away whatever ranking it had earned by then.
 */
export default function Page() {
  const groups = liveToolsByCategory();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{PROMISE}</h1>
        <p className={styles.reason}>{PROMISE_REASON}</p>
        <p className={styles.qualifier}>{PROMISE_QUALIFIER}</p>
      </header>

      {groups.map(({ category, tools }) => (
        <section key={category} className={styles.group}>
          <h2 className={styles.groupTitle}>{CATEGORY_LABELS[category]}</h2>
          <ul className={styles.list}>
            {tools.map((tool) => (
              <li key={tool.slug}>
                <Link href={toolPath(tool)} className={styles.card}>
                  <span className={styles.name}>{tool.name}</span>
                  <span className={styles.tagline}>{tool.tagline}</span>
                  <span className={styles.accepts}>{tool.accepts}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
