import { ClerkProvider } from "@clerk/nextjs";
import TrpcProvider from "@/components/providers/TrpcProvider";
import EnsureMembership from "@/components/providers/EnsureMembership";

/**
 * Scoped to (product) only, not the root layout — the marketing pages
 * ship zero React Query / tRPC / Clerk client JS.
 */
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <TrpcProvider>
        <EnsureMembership />
        {children}
      </TrpcProvider>
    </ClerkProvider>
  );
}
