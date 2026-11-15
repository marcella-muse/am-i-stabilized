import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Is my apartment rent stabilized?",
  description: "A free, guided check of NYC public records — with letters to find out for sure. Not legal advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
