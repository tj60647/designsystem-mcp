import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Design System AI",
  description: "A queryable context layer that makes design systems machine-readable and usable by AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
