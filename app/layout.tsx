import type { Metadata } from "next";
import { CloudSessionGate } from "@/components/cloud-session-gate";
import { ProductShell } from "@/components/product-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zora Star 创作空间",
  description: "面向图片、视频与无限画布的创作工作空间。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><CloudSessionGate><ProductShell>{children}</ProductShell></CloudSessionGate></body>
    </html>
  );
}
