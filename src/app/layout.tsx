import type { Metadata } from "next";
import { Chakra_Petch, Roboto, Roboto_Mono, VT323 } from "next/font/google";
import MatrixRain from "@/components/MatrixRain";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const sans = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
});

const mono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

// The Matrix theme's page titles. Only that theme uses it, so it isn't preloaded.
// The Cyberpunk theme's titles; not preloaded either.
const cyber = Chakra_Petch({
  variable: "--font-cyber",
  weight: ["500", "600"],
  subsets: ["latin"],
  preload: false,
});

const crt = VT323({
  variable: "--font-crt",
  weight: "400",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "workbench",
  description: "Every repo in your projects folder: status, dev servers, git and notes",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by the head script, so React's markup differs on purpose.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${crt.variable} ${cyber.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-full">
        <MatrixRain />
        {children}
      </body>
    </html>
  );
}
