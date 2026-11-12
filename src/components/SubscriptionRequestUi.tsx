import type { ReactNode } from "react";

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/80 bg-card">
      <h2 className="flex items-center gap-2 border-b border-border/70 px-5 py-4 text-base font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}