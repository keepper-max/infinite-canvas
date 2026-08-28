import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "镜界工坊 · AI 漫剧生产台",
  description: "从角色、场景到 Seedance 视频任务的可视化创作工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
