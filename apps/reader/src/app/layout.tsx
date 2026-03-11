import type { Metadata } from "next";
import "./globals.css";

const metadataBase = (() => {
  const explicitUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!explicitUrl) {
    return new URL("http://localhost:3000");
  }

  return new URL(explicitUrl.startsWith("http") ? explicitUrl : `https://${explicitUrl}`);
})();

export const metadata: Metadata = {
  metadataBase,
  title: "Reader",
  description: "A Reader-inspired reading workspace with mock interactions.",
  openGraph: {
    title: "Reader",
    description: "A Reader-inspired reading workspace with mock interactions.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reader",
    description: "A Reader-inspired reading workspace with mock interactions.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
