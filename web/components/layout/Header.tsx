import Link from "next/link";

export function Header({ asOf, wide = false }: { asOf?: string; wide?: boolean }) {
  return (
    <header className="border-b border-rule">
      <div
        className={`mx-auto flex ${wide ? "max-w-6xl" : "max-w-3xl"} flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4`}
      >
        <div className="flex items-baseline gap-5">
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
            MaStR Radar
          </Link>
          <nav className="flex gap-4 text-sm text-ink-muted">
            <Link href="/explore" className="hover:text-ink">
              Explore
            </Link>
            <Link href="/methodology" className="hover:text-ink">
              Methodology
            </Link>
          </nav>
        </div>
        {asOf && (
          <p className="figures text-sm text-ink-muted">
            Data as of <span className="text-ink">{asOf}</span>
          </p>
        )}
      </div>
    </header>
  );
}
