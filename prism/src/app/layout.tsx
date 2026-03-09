import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prism Codex",
  description: "AI-guided Socratic clarification workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
