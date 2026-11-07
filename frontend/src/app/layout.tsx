import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reels Studio | Quản lý Facebook Reels",
  description: "Không gian quản lý video và lịch đăng Facebook Reels.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
