import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./fa/fa-preview.css";
import "./he/he-preview.css";
import "./ar/ar-preview.css";
import { Providers } from "@/components/providers";
import { AdBannerGate } from "@/components/AdBannerGate";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { JsonLd } from "@/components/seo/JsonLd";
import { ThemeScript } from "@/components/ThemeScript";
import { ThemeSync } from "@/components/ThemeSync";
import { rootMetadata } from "@/lib/seo";

// Latin unicode-range from the Google Fonts CSS these files were taken from.
const latinUnicodeRange =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

// Geist sans, latin variable (wght 100–900, includes 400/500/600/700/800).
const geistSans = localFont({
  src: "./fonts/geist/Geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: latinUnicodeRange }],
});

// Geist Mono, latin variable (wght 100–900).
const geistMono = localFont({
  src: "./fonts/geist-mono/GeistMono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: latinUnicodeRange }],
});

// DM Sans, latin variable (wght 100–1000, includes 400/500/600/700/800).
const dmSans = localFont({
  src: "./fonts/dm-sans/DMSans-latin.woff2",
  variable: "--font-dm-sans",
  weight: "100 1000",
  style: "normal",
  display: "swap",
  preload: true,
  declarations: [{ prop: "unicode-range", value: latinUnicodeRange }],
});

export const metadata: Metadata = rootMetadata;

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
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var p=location.pathname||"";if(p==="/e"||p.indexOf("/e/")===0)return;var d=document.documentElement;var s="";try{s=localStorage.getItem("siteLanguage")||"";}catch(x){}function set(l,r,c){d.lang=l;d.dir=r;["fa-preview","he-preview","ar-preview"].forEach(function(k){d.classList.remove(k);});if(c)d.classList.add(c);}if(p==="/fa"||p.indexOf("/fa/")===0){d.lang="fa";d.dir="rtl";d.classList.add("fa-preview");}else if(p==="/es"||p.indexOf("/es/")===0){d.lang="es";d.dir="ltr";}else if(p==="/fr"||p.indexOf("/fr/")===0){d.lang="fr";d.dir="ltr";}else if(p==="/he"||p.indexOf("/he/")===0){d.lang="he";d.dir="rtl";d.classList.add("he-preview");}else if(p==="/ar"||p.indexOf("/ar/")===0){d.lang="ar";d.dir="rtl";d.classList.add("ar-preview");}else if(p==="/it"||p.indexOf("/it/")===0){d.lang="it";d.dir="ltr";}else if(p==="/de"||p.indexOf("/de/")===0){d.lang="de";d.dir="ltr";}else if(p==="/pt"||p.indexOf("/pt/")===0){d.lang="pt-BR";d.dir="ltr";}else if(s==="fa")set("fa","rtl","fa-preview");else if(s==="es")set("es","ltr");else if(s==="fr")set("fr","ltr");else if(s==="he")set("he","rtl","he-preview");else if(s==="ar")set("ar","rtl","ar-preview");else if(s==="it")set("it","ltr");else if(s==="de")set("de","ltr");else if(s==="pt")set("pt-BR","ltr");}catch(e){}})();',
          }}
        />
        <ThemeScript />
        <JsonLd />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <Providers>
          <ThemeSync />
          <GoogleAnalytics />
          <AdBannerGate />
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