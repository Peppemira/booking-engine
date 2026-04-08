import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SessionTopBar from "./SessionTopBar";

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
    <html lang="it">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionTopBar />
        {children}
      </body>
    </html>
  );
}
