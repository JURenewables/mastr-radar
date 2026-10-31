import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import { Footer } from "@/components/layout/Footer";
import { StaleDataBanner } from "@/components/layout/StaleDataBanner";
import { loadExplorerData } from "@/lib/data";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MaStR Radar",
  description:
    "Explore Germany's renewable energy units from the Marktstammdatenregister: maps, charts and tables, updated daily.",
  openGraph: { siteName: "MaStR Radar", type: "website", locale: "en_GB" },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const data = await loadExplorerData();
  const asOf = data.ok ? data.manifest.as_of : null;
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {asOf && <StaleDataBanner asOf={asOf} />}
        {children}
        <Footer />
      </body>
    </html>
  );
}
