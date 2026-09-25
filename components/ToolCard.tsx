import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { toolPath, type ToolMeta } from "@/lib/tools";

import { IconTile } from "./IconTile";
import styles from "./ToolCard.module.css";

interface ToolCardProps {
  tool: ToolMeta;
  /** Show what the tool accepts, under the tagline. The index does; a related-tools row does not. */
  showAccepts?: boolean;
}

/**
 * One tool as a card: its icon on a category-coloured tile, its name, its
 * tagline and what it takes.
 *
 * The same card on the index, under a tool and on the 404, so the catalogue
 * looks like one catalogue wherever a piece of it appears.
 */
export function ToolCard({ tool, showAccepts = false }: ToolCardProps) {
  return (
    <Link href={toolPath(tool)} className={styles.card}>
      <span className={styles.head}>
        <IconTile icon={tool.icon} category={tool.category} />
        <ArrowUpRight aria-hidden="true" size={16} strokeWidth={2} className={styles.arrow} />
      </span>
      <span className={styles.name}>{tool.name}</span>
      <span className={styles.tagline}>{tool.tagline}</span>
      {showAccepts && <span className={styles.accepts}>{tool.accepts}</span>}
    </Link>
  );
}
