import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

/*
 * Inter, self-hosted by next/font: the files are fetched at build time and
 * served from this origin, so no request leaves the visitor's browser for a
 * font. `opsz` is Inter 4's optical-size axis, which picks the tighter display
 * cut at heading sizes on its own; the tracking token in globals.css does the
 * rest, and most of the work at body size where opsz is close to neutral.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  /*
   * Tool pages set a bare `title` and this wraps it, so a page stays
   * responsible for naming itself and nothing repeats the site name by hand.
   */
  title: {
    default: "Free browser tools with no file size limit",
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Convert, compress and edit files entirely in your browser. Nothing is uploaded, so there is no file size limit and nothing to pay.",
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c10" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
