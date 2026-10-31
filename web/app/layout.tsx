import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";

import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MaStR Radar",
  description:
    "Explore Germany's renewable energy units from the Marktstammdatenregister: maps, charts and tables, updated daily.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${newsreader.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Footer />
      </body>
    </html>
  );
}
