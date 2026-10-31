import Link from "next/link";

export function Header({ asOf }: { asOf?: string }) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-5 py-4">
        <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
          MaStR Radar
        </Link>
        {asOf && (
          <p className="figures text-sm text-ink-muted">
            Data as of <span className="text-ink">{asOf}</span>
          </p>
        )}
      </div>
    </header>
  );
}
