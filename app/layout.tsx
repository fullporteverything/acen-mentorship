import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suite 7 — Private Mentorship",
  description: "Private Mentorship Platform — Master the markets. Understand liquidity. See what others cannot.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Suite 7 — Private Mentorship",
    description: "Private Mentorship Platform",
    type: "website",
  },
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
