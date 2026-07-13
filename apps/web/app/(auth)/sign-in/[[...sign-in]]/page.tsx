import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <SignIn
      appearance={{
        variables: {
          colorPrimary: "#D97706",
          colorBackground: "#000000",
        },
      }}
    />
  );
}
