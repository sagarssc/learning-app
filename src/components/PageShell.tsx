/** Scrollable page frame for the non-feed screens (Add, Library, Domains). */
export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-2xl px-5 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
