import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LingkeAI 无限画布",
  description: "支持文本、图片和视频生成节点的可平移、可缩放无限画布。",
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
