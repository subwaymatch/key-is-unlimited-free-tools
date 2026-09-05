import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/*
 * Inter, self-hosted by next/font — the file is fetched at build time and
 * served from this origin, so no request leaves the visitor's browser. The
 * grid leans on Inter's tight, even colour; the tracking is pulled in globally
 * (see `--tracking-body`).
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Extract Audio from Video",
  description:
    "Pull the audio track out of any video, entirely in your browser. Files never leave your device, and multi-gigabyte videos are supported.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
