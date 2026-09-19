import { z } from "zod";

// Must match emailAndPassword.minPasswordLength in src/lib/auth.ts.
export const MIN_PASSWORD_LENGTH = 10;
// Better Auth's default maximum.
export const MAX_PASSWORD_LENGTH = 128;

export const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);

export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords do not match",
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
