import { health } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check for the MCP server: loads the query engine and reports the data date.
export async function GET() {
  const h = await health();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
