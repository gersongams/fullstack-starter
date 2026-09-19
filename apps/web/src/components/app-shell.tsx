"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserMenu, type ShellUser } from "@/components/user-menu";
import { cn } from "@/lib/utils";

// Add a signed-in section here, its page under src/app/(app), and its path to
// the matcher in src/proxy.ts.
const NAVIGATION = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
] as const;

function Wordmark() {
  return (
    <Link href="/dashboard" className="text-[0.9375rem] font-semibold tracking-tight">
      Fullstack Starter
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {NAVIGATION.map((item) => {
          const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  current
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({
  user,
  banner,
  children,
}: {
  user: ShellUser;
  /** Account-level notice shown above every page, such as "confirm your email". */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between gap-2 border-b px-4 py-2 md:hidden">
        <div className="flex items-center gap-2">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <MenuIcon aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle>Fullstack Starter</SheetTitle>
                <SheetDescription className="sr-only">Main navigation</SheetDescription>
              </SheetHeader>
              <div className="px-4">
                <Navigation onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Wordmark />
        </div>
        <UserMenu user={user} compact />
      </header>

      <aside className="margin-rule hidden w-60 shrink-0 flex-col justify-between gap-6 py-5 pr-5 pl-4 md:flex">
        <div className="space-y-6">
          <div className="px-2">
            <Wordmark />
          </div>
          <Navigation />
        </div>
        <UserMenu user={user} />
      </aside>

      <main id="content" className="min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10">
        <div className="mx-auto w-full max-w-4xl">
          {banner}
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}
