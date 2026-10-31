import { buildCatalog } from "@/lib/catalog";

// Built once per deploy (the data changes once a day).
export const dynamic = "force-static";

export async function GET() {
  return Response.json(await buildCatalog());
}
