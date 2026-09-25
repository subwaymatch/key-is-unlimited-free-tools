import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { relatedTools } from "@/lib/tools";

import { ToolCard } from "./ToolCard";
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
      <div className={styles.head}>
        <h2 id="related-tools" className={styles.title}>
          More tools
        </h2>
        <Link href="/" className={styles.all}>
          All tools
          <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
        </Link>
      </div>
      <ul className={styles.list}>
        {tools.map((tool) => (
          <li key={tool.slug}>
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </section>
  );
}
