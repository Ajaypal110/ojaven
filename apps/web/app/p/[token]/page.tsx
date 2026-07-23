import type { Metadata } from "next";
import TrpcProvider from "@/components/providers/TrpcProvider";
import { ProposalView } from "./ProposalView";

// The first unauthenticated surface. Outside the (product) layout, so NO
// ClerkProvider — just a Clerk-free tRPC provider for the public.* endpoints.
// noindex overrides the root layout's index:true; /p is also disallowed in
// robots.txt. Proposal URLs must never be indexed.
// Override EVERY inherited field that names Ojaven — not just title. The root
// layout's og:*/twitter:*/description carry "Ojaven — All-in-one platform…" and
// the og-image, which would leak the stealth product in a link's social preview
// when a client pastes the /p URL. Redefining openGraph/twitter here replaces
// the root's wholesale (Next resolves metadata per-segment, no deep merge).
export const metadata: Metadata = {
  title: "Proposal",
  description: "You have received a proposal.",
  robots: { index: false, follow: false },
  openGraph: { title: "Proposal", description: "You have received a proposal.", images: [] },
  twitter: { card: "summary", title: "Proposal", description: "You have received a proposal.", images: [] },
};

export default function PublicProposalPage({ params }: { params: { token: string } }) {
  return (
    <TrpcProvider>
      <ProposalView token={params.token} />
    </TrpcProvider>
  );
}
