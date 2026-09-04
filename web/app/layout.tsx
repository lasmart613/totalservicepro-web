import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import AdBanner from "@/components/AdBanner";
import { ThemeScript } from "@/components/ThemeScript";
import { ThemeSync } from "@/components/ThemeSync";
import { ADSENSE_CLIENT } from "@/lib/adsense";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RepairPlanet · Total Service Pro",
  description:
    "RepairPlanet is a biomedical equipment service network for clinics — lasers, lithotriptors, and C-arms first. Total Service Pro from Medical Repair Network is the operating system behind the network.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <Script
          id="tsp-adsense"
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        <Providers>
          <ThemeSync />
          <AdBanner />
          <div className="flex-1 flex flex-col">
		<main className="flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-full">
		{children}
		</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}