import { health } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check for the MCP server: loads the query engine and reports the data date.
export async function GET() {
  try {
    return Response.json(await health(), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
