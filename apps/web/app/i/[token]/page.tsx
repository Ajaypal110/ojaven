import type { Metadata } from "next";
import TrpcProvider from "@/components/providers/TrpcProvider";
import { InvoiceView } from "./InvoiceView";

// Public invoice view — same posture as /p (the A6 lesson applied from day
// one): outside (product), no ClerkProvider, noindex, robots.txt-disallowed,
// and EVERY inherited og/twitter/description field overridden so a shared link
// preview never names the stealth product.
export const metadata: Metadata = {
  title: "Invoice",
  description: "You have received an invoice.",
  robots: { index: false, follow: false },
  openGraph: { title: "Invoice", description: "You have received an invoice.", images: [] },
  twitter: { card: "summary", title: "Invoice", description: "You have received an invoice.", images: [] },
};

export default function PublicInvoicePage({ params }: { params: { token: string } }) {
  return (
    <TrpcProvider>
      <InvoiceView token={params.token} />
    </TrpcProvider>
  );
}
