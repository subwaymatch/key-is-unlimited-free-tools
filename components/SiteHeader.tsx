"use client";

import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { ChevronDown, ChevronRight, LayoutGrid, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SITE_NAME } from "@/lib/site";
import { CATEGORY_LABELS, liveToolsByCategory, toolPath } from "@/lib/tools";

import { ToolIcon } from "./ToolIcon";
import styles from "./SiteHeader.module.css";

/*
 * Wordmark, an "All tools" menu grouped by category, the name of the tool
 * being used, and the promise in three words at the far end.
 *
 * The plain row of links this replaced wrapped to three lines once the
 * catalogue passed a dozen tools, which spent the top of every page on
 * navigation before the tool began. This is the grouped Navigation Menu
 * section 7.4 of the plan asked for at that point. The content is kept
 * mounted, so every link is in the server-rendered HTML for a crawler; the
 * footer carries the same list as plain anchors either way.
 *
 * It is a client component for one reason: the current tool should look
 * current, in the menu and beside it.
 */
export function SiteHeader() {
  const groups = liveToolsByCategory();
  const pathname = usePathname();
  const current = groups.flatMap((group) => group.tools).find((tool) => toolPath(tool) === pathname);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          {/*
           * The mark is decorative: the wordmark beside it already says the
           * name, so a second copy in alt text would have a screen reader
           * read "key.is key.is". Width and height are set so the row does
           * not reflow while the file is on its way.
           */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} className={styles.mark} />
          <span className={styles.name}>{SITE_NAME}</span>
        </Link>

        <nav aria-label="Tools" className={styles.nav}>
          <NavigationMenu.Root className={styles.menu}>
            <NavigationMenu.List className={styles.list}>
              <NavigationMenu.Item>
                <NavigationMenu.Trigger className={styles.trigger}>
                  <LayoutGrid aria-hidden="true" size={15} strokeWidth={2} />
                  All tools
                  <NavigationMenu.Icon className={styles.icon}>
                    <ChevronDown aria-hidden="true" size={15} strokeWidth={2} />
                  </NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted className={styles.content}>
                  {groups.map(({ category, tools }) => (
                    <section key={category} className={styles.group}>
                      <h2 className={styles.groupTitle}>
                        <span
                          aria-hidden="true"
                          className={styles.groupDot}
                          data-category={category}
                        />
                        {CATEGORY_LABELS[category]}
                        <span className={styles.groupCount}>{tools.length}</span>
                      </h2>
                      <ul className={styles.groupList}>
                        {tools.map((tool) => {
                          const path = toolPath(tool);
                          return (
                            <li key={tool.slug}>
                              <NavigationMenu.Link
                                render={<Link href={path} />}
                                active={pathname === path}
                                className={styles.link}
                              >
                                <ToolIcon name={tool.icon} className={styles.linkIcon} />
                                {tool.name}
                              </NavigationMenu.Link>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </NavigationMenu.Content>
              </NavigationMenu.Item>
            </NavigationMenu.List>

            <NavigationMenu.Portal>
              <NavigationMenu.Positioner
                sideOffset={10}
                align="start"
                collisionPadding={16}
                className={styles.positioner}
              >
                <NavigationMenu.Popup className={styles.popup}>
                  <NavigationMenu.Viewport className={styles.viewport} />
                </NavigationMenu.Popup>
              </NavigationMenu.Positioner>
            </NavigationMenu.Portal>
          </NavigationMenu.Root>
        </nav>

        {current && (
          <span className={styles.crumb}>
            <ChevronRight aria-hidden="true" size={14} strokeWidth={2} className={styles.crumbIcon} />
            <span className={styles.current}>{current.name}</span>
          </span>
        )}

        <span className={styles.spacer} />

        {/*
         * The promise, where the eye lands last on every page. The header is
         * the one part of the site a visitor sees before they know what the
         * site is, so this is the first thing it says about itself.
         */}
        <span className={styles.badge}>
          <ShieldCheck aria-hidden="true" size={15} strokeWidth={2} />
          Nothing is uploaded
        </span>
      </div>
    </header>
  );
}
