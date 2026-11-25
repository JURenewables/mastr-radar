import { loadDictionary, llmsFull } from "@/lib/dictionary";
import { buildCatalog } from "@/lib/catalog";

export const dynamic = "force-static";

// Full reference for AI agents, generated from the checked data dictionary.
export async function GET() {
  const [d, c] = await Promise.all([loadDictionary(), buildCatalog()]);
  const body = d ? llmsFull(d, c.as_of) : "Data dictionary not available.";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
