"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearApiToken } from "@/lib/api/token";
import { authClient } from "@/lib/auth-client";

const SIGN_OUT_FAILED = "Could not sign out. Try again.";

export type ShellUser = { name: string; email: string };

export function UserMenu({ user, compact = false }: { user: ShellUser; compact?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSignOut() {
    setPending(true);
    setError(undefined);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(result.error.message ?? SIGN_OUT_FAILED);
        setPending(false);
        return;
      }

      // Only after the session is really gone, and in this order: the token
      // first, so nothing refetches with it while the cache is being cleared.
      clearApiToken();
      queryClient.clear();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      // No `finally`: React Compiler skips components that use one, and
      // `pending` stays set on success until the navigation replaces this page.
      setError(SIGN_OUT_FAILED);
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Account menu"
          className={
            compact
              ? "h-9 max-w-40 justify-between gap-2 px-2"
              : "h-auto w-full justify-between gap-2 px-2 py-2 text-left"
          }
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            {!compact && (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            )}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            // Keep the menu open: a failure is reported right here.
            event.preventDefault();
            void handleSignOut();
          }}
        >
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        {error && (
          <p role="alert" className="px-2 py-1.5 text-sm text-destructive">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
