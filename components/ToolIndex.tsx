"use client";

import { Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  liveToolsByCategory,
  type ToolCategory,
  type ToolMeta,
} from "@/lib/tools";

import { ToolCard } from "./ToolCard";
import styles from "./ToolIndex.module.css";

interface ToolIndexProps {
  /** The hero's words, rendered above the search so they share its ground. */
  hero: ReactNode;
  /** The fine print under the search. */
  note?: ReactNode;
}

/** Everything a tool can be found by, lowercased once. */
function haystack(tool: ToolMeta): string {
  return [
    tool.name,
    tool.tagline,
    tool.accepts,
    tool.slug.replace(/-/g, " "),
    CATEGORY_LABELS[tool.category],
  ]
    .join(" ")
    .toLowerCase();
}

/** Every word typed has to appear somewhere, in any order. */
function matches(text: string, words: string[]): boolean {
  return words.every((word) => text.includes(word));
}

/**
 * The index of every live tool, with a search box over it.
 *
 * A hundred cards is more than anyone scans. Typing filters them as the
 * letters land, hides the categories left empty, and says how many are left;
 * the section links jump to a category when nothing is typed. The list is in
 * the server-rendered HTML in full, so a crawler and a visitor without
 * JavaScript get the whole catalogue either way.
 */
export function ToolIndex({ hero, note }: ToolIndexProps) {
  const groups = useMemo(() => liveToolsByCategory(), []);
  const indexed = useMemo(
    () => groups.map((group) => ({ ...group, entries: group.tools.map((tool) => ({ tool, text: haystack(tool) })) })),
    [groups],
  );
  const total = groups.reduce((sum, group) => sum + group.tools.length, 0);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const words = deferred.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;

  const visible = indexed.map((group) => ({
    category: group.category,
    tools: searching
      ? group.entries.filter((entry) => matches(entry.text, words)).map((entry) => entry.tool)
      : group.tools,
  }));
  const shown = visible.reduce((sum, group) => sum + group.tools.length, 0);

  /*
   * "/" focuses the search from anywhere on the page, the way it does on
   * most sites with one search box, unless something else is being typed in.
   */
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const searchId = useId();

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          {hero}

          <div className={styles.search}>
            <label htmlFor={searchId} className="visually-hidden">
              Search tools
            </label>
            <Search aria-hidden="true" size={18} strokeWidth={2} className={styles.searchIcon} />
            <input
              ref={inputRef}
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${total} tools: compress video, merge pdf, mp3...`}
              autoComplete="off"
              spellCheck={false}
              className={styles.searchInput}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className={styles.searchClear}
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            ) : (
              <kbd aria-hidden="true" className={styles.searchKey}>
                /
              </kbd>
            )}
          </div>

          <p role="status" aria-live="polite" className={styles.count}>
            {searching
              ? shown === 0
                ? "No tool matches that."
                : `${shown} of ${total} tools match.`
              : note}
          </p>
        </div>
      </section>

      <nav aria-label="Categories" className={styles.chips}>
        {visible.map((group) => (
          <a
            key={group.category}
            href={`#${group.category}`}
            className={styles.chip}
            data-category={group.category}
            data-empty={group.tools.length === 0 ? "" : undefined}
          >
            <span className={styles.chipDot} aria-hidden="true" />
            {CATEGORY_LABELS[group.category]}
            <span className={styles.chipCount}>{group.tools.length}</span>
          </a>
        ))}
      </nav>

      {shown === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing here matches &quot;{deferred.trim()}&quot;.</p>
          <p className={styles.emptyHint}>
            Try a format such as mp4 or pdf, a verb such as compress or merge, or clear the search
            and browse by category.
          </p>
          <button type="button" onClick={() => setQuery("")} className={styles.emptyButton}>
            Clear the search
          </button>
        </div>
      )}

      {visible.map(
        (group) =>
          group.tools.length > 0 && (
            <CategorySection key={group.category} category={group.category} tools={group.tools} />
          ),
      )}
    </>
  );
}

function CategorySection({ category, tools }: { category: ToolCategory; tools: ToolMeta[] }) {
  return (
    <section id={category} className={styles.group} aria-labelledby={`${category}-title`}>
      <header className={styles.groupHead}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/illustrations/${category}.webp`}
          alt=""
          width={72}
          height={72}
          className={styles.art}
        />
        <div className={styles.groupText}>
          <h2 id={`${category}-title`} className={styles.groupTitle}>
            {CATEGORY_LABELS[category]}
            <span className={styles.groupCount}>{tools.length}</span>
          </h2>
          <p className={styles.groupBlurb}>{CATEGORY_BLURBS[category]}</p>
        </div>
      </header>
      <ul className={styles.grid}>
        {tools.map((tool) => (
          <li key={tool.slug}>
            <ToolCard tool={tool} showAccepts />
          </li>
        ))}
      </ul>
    </section>
  );
}
