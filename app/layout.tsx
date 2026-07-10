import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ojaven.com"),
  title: "Ojaven — All-in-one platform for marketing agencies",
  description:
    "Kill the SaaS tax. Ojaven replaces SEMrush, GoHighLevel, ClickUp, and more with one platform. Currently in stealth. Join the waitlist.",
  openGraph: {
    title: "Ojaven — All-in-one platform for marketing agencies",
    description:
      "Kill the SaaS tax. Ojaven replaces SEMrush, GoHighLevel, ClickUp, and more with one platform. Currently in stealth. Join the waitlist.",
    url: "https://ojaven.com",
    siteName: "Ojaven",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Ojaven — The all-in-one platform for marketing agencies",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ojaven — All-in-one platform for marketing agencies",
    description:
      "Kill the SaaS tax. Ojaven replaces SEMrush, GoHighLevel, ClickUp, and more with one platform. Currently in stealth. Join the waitlist.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
