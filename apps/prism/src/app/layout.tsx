import type { Metadata } from "next";
import "./globals.css";

const metadataBase = (() => {
  const explicitUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL;

  if (!explicitUrl) {
    return new URL("http://localhost:3000");
  }

  return new URL(explicitUrl.startsWith("http") ? explicitUrl : `https://${explicitUrl}`);
})();

export const metadata: Metadata = {
  metadataBase,
  title: "Prism",
  description: "AI-guided Socratic clarification workspace",
  openGraph: {
    title: "Prism",
    description: "AI-guided Socratic clarification workspace",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prism",
    description: "AI-guided Socratic clarification workspace",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
