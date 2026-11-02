import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kfe Studio — your sewing library",
  description: "Keep your fabric, patterns, and future sewing projects together.",
  applicationName: "Kfe Studio",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Kfe Studio",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#526e5a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
