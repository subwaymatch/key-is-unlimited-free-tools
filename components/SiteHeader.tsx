"use client";

import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SITE_NAME } from "@/lib/site";
import { CATEGORY_LABELS, liveToolsByCategory, toolPath } from "@/lib/tools";

import { ToolIcon } from "./ToolIcon";
import styles from "./SiteHeader.module.css";

/*
 * Wordmark, an "All tools" menu grouped by category, and the name of the
 * tool being used.
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
          {SITE_NAME}
        </Link>

        <nav aria-label="Tools" className={styles.nav}>
          <NavigationMenu.Root className={styles.menu}>
            <NavigationMenu.List className={styles.list}>
              <NavigationMenu.Item>
                <NavigationMenu.Trigger className={styles.trigger}>
                  All tools
                  <NavigationMenu.Icon className={styles.icon}>
                    <ChevronDown aria-hidden="true" size={16} />
                  </NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content keepMounted className={styles.content}>
                  {groups.map(({ category, tools }) => (
                    <section key={category} className={styles.group}>
                      <h2 className={styles.groupTitle}>{CATEGORY_LABELS[category]}</h2>
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
                sideOffset={8}
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

        {current && <span className={styles.current}>{current.name}</span>}
      </div>
    </header>
  );
}
