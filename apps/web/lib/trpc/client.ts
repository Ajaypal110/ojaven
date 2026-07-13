import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@ojaven/server";

export const trpc = createTRPCReact<AppRouter>();
