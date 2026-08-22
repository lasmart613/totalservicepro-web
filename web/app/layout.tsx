import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import AdBanner from "@/components/AdBanner";

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
  title: "Total Service Pro · Medical Repair Network",
  description:
    "Register for Total Service Pro — Medical Repair Network’s app for aesthetic and medical laser service, parts, and the daily work of clinics, repair companies, and parts sellers.",
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
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <Providers>
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