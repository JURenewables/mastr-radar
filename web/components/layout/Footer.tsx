import Link from "next/link";

// Required on every page (CLAUDE.md, contract v1.1 station 4).
export function Footer() {
  return (
    <footer className="mt-auto border-t border-rule">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-5 py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          Data:{" "}
          <a
            href="https://www.govdata.de/dl-de/by-2-0"
            className="underline decoration-rule underline-offset-2 hover:text-ink"
          >
            © Bundesnetzagentur, DL-DE-BY-2.0
          </a>
          . Data processed by MaStR Radar.
        </p>
        <Link
          href="/methodology"
          className="underline decoration-rule underline-offset-2 hover:text-ink"
        >
          Methodology
        </Link>
      </div>
    </footer>
  );
}
