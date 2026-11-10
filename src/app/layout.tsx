import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Media Generator",
  description: "لوحة إدارة مولّد الصور والفيديو وخادم MCP"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}