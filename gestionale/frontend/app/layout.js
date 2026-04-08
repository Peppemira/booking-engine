import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SessionTopBar from "./SessionTopBar";
import Providers from "./Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Gestionale Autoscuola BLUEFOX",
  description: "Gestionale Autoscuola",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <SessionTopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
