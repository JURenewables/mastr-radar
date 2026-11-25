// MCP server endpoint (contract v1.10): Streamable HTTP, stateless, read-only.
// Connect: claude mcp add --transport http mastr-radar https://mastr-radar.vercel.app/mcp
import { handleBody } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Authorization, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Protocol-Version",
};

const MAX_BODY = 64_000;

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return rpcError(413, -32600, "Request too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rpcError(400, -32700, "Parse error: send a JSON-RPC message.");
  }
  const res = await handleBody(body);
  if (res === null) return new Response(null, { status: 202, headers: CORS });
  return Response.json(res, { headers: { ...CORS, "Cache-Control": "no-store" } });
}

// Stateless server: no server-initiated stream and no sessions to end.
export function GET() {
  return new Response("MaStR Radar MCP server. Send JSON-RPC over POST. Setup: https://mastr-radar.vercel.app/open-data", {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function rpcError(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: CORS });
}
