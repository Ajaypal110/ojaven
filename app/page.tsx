import WaitlistForm from "@/components/WaitlistForm";
import SocialLinks from "@/components/SocialLinks";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <header
        className="animate-fade-in flex items-center justify-between p-8"
        style={{ animationDelay: "200ms" }}
      >
        <span className="text-sm font-medium tracking-tight text-foreground">
          ojaven<span className="text-accent">.</span>
        </span>
        <span className="text-sm text-muted">est. 2026</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1
          className="animate-fade-in text-[4rem] font-extrabold leading-none tracking-[-0.04em] sm:text-[8rem]"
          style={{ animationDelay: "0ms" }}
        >
          ojaven<span className="text-accent">.</span>
        </h1>

        <div
          className="animate-fade-in mt-8 mb-6 h-px w-10 bg-white/30"
          style={{ animationDelay: "300ms" }}
          aria-hidden="true"
        />

        <p
          className="animate-fade-in max-w-md text-base text-muted sm:text-lg"
          style={{ animationDelay: "400ms" }}
        >
          The all-in-one platform for marketing agencies.
        </p>

        <p
          className="animate-fade-in mt-2 text-base font-normal text-muted"
          style={{ animationDelay: "450ms" }}
        >
          Kill the SaaS tax. One place. One price.
        </p>

        <div
          className="animate-fade-in mt-10 flex w-full flex-col items-center"
          style={{ animationDelay: "600ms" }}
        >
          <WaitlistForm />
          <p className="mt-4 text-xs text-muted">
            Join agencies already on the list. No spam. Ever.
          </p>
        </div>
      </main>

      <footer
        className="animate-fade-in flex flex-row items-center justify-between gap-3 p-8"
        style={{ animationDelay: "1000ms" }}
      >
        <a
          href="https://linkedin.com/company/ojaven"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Building in public →
        </a>
        <SocialLinks />
      </footer>
    </div>
  );
}
