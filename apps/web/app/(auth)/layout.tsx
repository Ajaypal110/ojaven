import { ClerkProvider } from "@clerk/nextjs";

/**
 * ClerkProvider scoped here (and in (product)/layout.tsx), not the root
 * layout — it's pure React context, has no dependency on being at the
 * true root, and this keeps Clerk's client SDK out of the marketing
 * pages' bundle. clerkMiddleware() enforces auth independently at the
 * edge regardless of where this sits in the tree.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <span className="mb-10 text-2xl font-extrabold tracking-tight text-foreground">
          ojaven<span className="text-accent">.</span>
        </span>
        {children}
      </div>
    </ClerkProvider>
  );
}
