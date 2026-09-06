import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

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
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
