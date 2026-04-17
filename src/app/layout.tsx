import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crypto Screener — Binance, Bybit, OKX",
  description:
    "Скринер USDT perpetual: NATR, объём, графики, импульсы и уведомления",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`h-full antialiased ${jetbrainsMono.variable}`}>
      <body className="flex min-h-full flex-col bg-[#0b0e11] text-zinc-200 font-mono">
        {children}
      </body>
    </html>
  );
}
