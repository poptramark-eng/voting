import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voting Platform",
  description: "A configurable platform for polls, contests and organizational elections.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
