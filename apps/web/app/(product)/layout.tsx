import TrpcProvider from "@/components/providers/TrpcProvider";

/**
 * Scoped to (product) only, not the root layout — the marketing pages
 * ship zero React Query / tRPC client JS.
 */
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <TrpcProvider>{children}</TrpcProvider>;
}
