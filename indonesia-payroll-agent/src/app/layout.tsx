import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indonesia Payroll Agent",
  description: "Internal payroll delivery system for Indonesia payroll runs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
