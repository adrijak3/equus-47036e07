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
    <section className="overflow-hidden rounded-2xl border border-gold/15 bg-gradient-card shadow-elegant">
      <h2 className="flex items-center gap-2 border-b border-gold/10 px-5 py-3 font-display text-lg text-gold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}