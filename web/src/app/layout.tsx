import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Waste System | Recycle to earn",
  description: "Blockchain rewards for recyclable material collections.",
  alternates: { canonical: "/" },
  openGraph: { title: "Waste System", description: "Blockchain rewards for recyclable material collections.", url: appUrl, siteName: "Waste System", type: "website" }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
