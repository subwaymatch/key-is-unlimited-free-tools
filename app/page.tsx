import { BadgeCheck, Infinity as InfinityIcon, LockKeyhole, Sparkles } from "lucide-react";

import { ToolIndex } from "@/components/ToolIndex";
import { PROMISE, PROMISE_QUALIFIER, PROMISE_REASON } from "@/lib/site";
import { liveTools } from "@/lib/tools";

import styles from "./page.module.css";

/*
 * The index of every live tool.
 *
 * This is the front page from the first tool onwards, not from the second: an
 * index with one entry is honest, and moving the tool off "/" later would throw
 * away whatever ranking it had earned by then.
 */
export default function Page() {
  const count = liveTools().length;

  return (
    <main className={styles.page}>
      <ToolIndex
        hero={
          <>
            <p className={styles.eyebrow}>
              <Sparkles aria-hidden="true" size={14} strokeWidth={2} />
              {count} tools, all in your browser
            </p>
            <h1 className={styles.title}>{PROMISE}</h1>
            <p className={styles.reason}>{PROMISE_REASON}</p>
          </>
        }
        note={PROMISE_QUALIFIER}
      />

      <ul className={styles.pillars} aria-label="What makes this possible">
        <li className={styles.pillar}>
          <span className={styles.pillarIcon}>
            <LockKeyhole aria-hidden="true" size={18} strokeWidth={2} />
          </span>
          <span>
            <span className={styles.pillarTitle}>Nothing is uploaded</span>
            <span className={styles.pillarText}>
              A file is opened by the page and handed to an engine running in this tab. No server
              ever sees it.
            </span>
          </span>
        </li>
        <li className={styles.pillar}>
          <span className={styles.pillarIcon}>
            <InfinityIcon aria-hidden="true" size={18} strokeWidth={2} />
          </span>
          <span>
            <span className={styles.pillarTitle}>No file size limit</span>
            <span className={styles.pillarText}>
              Large files are read from disk on demand rather than loaded into memory, so a 3 GB
              video works like a 3 MB one.
            </span>
          </span>
        </li>
        <li className={styles.pillar}>
          <span className={styles.pillarIcon}>
            <BadgeCheck aria-hidden="true" size={18} strokeWidth={2} />
          </span>
          <span>
            <span className={styles.pillarTitle}>Free, with no account</span>
            <span className={styles.pillarText}>
              No sign-up, no quota, no queue and nothing to buy. There is no server to pay for.
            </span>
          </span>
        </li>
      </ul>
    </main>
  );
}
