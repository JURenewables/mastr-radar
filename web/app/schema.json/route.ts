import { buildCatalog } from "@/lib/catalog";
import { jsonSchema, loadDictionary } from "@/lib/dictionary";

export const dynamic = "force-static";

// Machine-readable fields of every dataset, generated from the data dictionary.
export async function GET() {
  const [d, c] = await Promise.all([loadDictionary(), buildCatalog()]);
  return Response.json(d ? jsonSchema(d, c.as_of) : { error: "Data dictionary not available." }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
