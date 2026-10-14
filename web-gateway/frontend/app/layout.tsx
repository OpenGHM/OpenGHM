import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { DevelopmentNotice } from "@/components/layout/development-notice";
import { siteFeatures } from "@/lib/features";

// Geist is the text face and Geist Mono the face of eyebrow labels, versions,
// coordinates and ids; globals.css maps them to font-sans and font-mono.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenGHM Gateway",
  description: "FAIR Cyberinfrastructure for Global Hydrologic Modeling",
};

// Every page is rendered at request time, so `siteFeatures()` reads the
// deployment's environment rather than the one `next build` ran in.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <DevelopmentNotice />
        <Providers features={siteFeatures()}>{children}</Providers>
      </body>
    </html>
  );
}
