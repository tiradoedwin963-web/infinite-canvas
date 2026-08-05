import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "无限画布",
  description: "一块可平移、可缩放的空白无限画布。",
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
