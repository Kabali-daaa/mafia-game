import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Cinzel } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

// Engraved, classical serif for the noir headings & role names.
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Mafia",
  description: "A real-time party game of Mafia for host and players.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0807",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${cinzel.variable} font-sans`}>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
