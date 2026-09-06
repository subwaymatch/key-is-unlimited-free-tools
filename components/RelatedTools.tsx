import Link from "next/link";

import { relatedTools, toolPath } from "@/lib/tools";

import styles from "./RelatedTools.module.css";

interface RelatedToolsProps {
  /** The tool being shown, excluded from its own list. */
  slug: string;
}

/**
 * Sibling tools, shown under the tool the visitor just used.
 *
 * Renders nothing while this is the only live tool, rather than an empty
 * heading.
 */
export function RelatedTools({ slug }: RelatedToolsProps) {
  const tools = relatedTools(slug);
  if (tools.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="related-tools">
      <h2 id="related-tools" className={styles.title}>
        Other tools
      </h2>
      <ul className={styles.list}>
        {tools.map((tool) => (
          <li key={tool.slug}>
            <Link href={toolPath(tool)} className={styles.card}>
              <span className={styles.name}>{tool.name}</span>
              <span className={styles.tagline}>{tool.tagline}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
