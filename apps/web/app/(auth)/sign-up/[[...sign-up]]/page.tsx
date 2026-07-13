import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <SignUp
      appearance={{
        variables: {
          colorPrimary: "#D97706",
          colorBackground: "#000000",
        },
      }}
    />
  );
}
