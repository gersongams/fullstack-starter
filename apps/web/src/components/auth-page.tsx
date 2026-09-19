import type { ReactNode } from "react";

/** The frame shared by every signed-out page: wordmark, title, content. */
export function AuthPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-sm font-semibold tracking-tight">Fullstack Starter</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export const authLinkClass = "font-medium text-foreground underline underline-offset-4";
