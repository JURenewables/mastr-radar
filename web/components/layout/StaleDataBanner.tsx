"use client";

import { useSyncExternalStore } from "react";

import { formatDate } from "@/lib/format";

// The daily update normally brings data dated today. If it is older than this,
// the update has failed for a while and visitors should know (WP25).
const MAX_AGE_DAYS = 2;

const subscribe = () => () => {};

export function StaleDataBanner({ asOf }: { asOf: string }) {
  // Computed in the browser only: the page itself is built once per day.
  const ageDays = useSyncExternalStore(
    subscribe,
    () => Math.floor((Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000),
    () => 0,
  );
  if (ageDays <= MAX_AGE_DAYS) return null;
  return (
    <div role="status" className="bg-accent px-5 py-2 text-center text-sm text-paper">
      The data is from {formatDate(asOf)}, {ageDays} days ago: the daily update is delayed.
    </div>
  );
}
