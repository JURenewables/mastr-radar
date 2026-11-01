import Link from "next/link";

export function Header({ asOf, wide = false }: { asOf?: string; wide?: boolean }) {
  return (
    <header className="border-b border-rule">
      <div
        className={`mx-auto flex ${wide ? "max-w-6xl" : "max-w-3xl"} flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4`}
      >
        <div className="flex min-w-0 max-w-full items-baseline gap-5">
          <Link href="/" className="font-serif text-lg">
            MaStR Radar
          </Link>
          <nav className="scroll-row flex min-w-0 gap-4 overflow-x-auto whitespace-nowrap text-sm text-ink-muted">
            <Link href="/" className="hover:text-ink">
              Monitor
            </Link>
            <Link href="/solar" className="hover:text-ink">
              Solar
            </Link>
            <Link href="/wind" className="hover:text-ink">
              Wind
            </Link>
            <Link href="/grid" className="hover:text-ink">
              Grid
            </Link>
            <Link href="/players" className="hover:text-ink">
              Players
            </Link>
            <Link href="/explore" className="hover:text-ink">
              Explore
            </Link>
            <Link href="/open-data" className="hover:text-ink">
              Data
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
