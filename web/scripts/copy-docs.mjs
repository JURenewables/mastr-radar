// The MCP server serves the data contract as a resource (mastr-radar://contract).
// Copy it from ../docs before dev and build; skip quietly if not available.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

mkdirSync("mcp-docs", { recursive: true });
if (existsSync("../docs/contracts.md")) copyFileSync("../docs/contracts.md", "mcp-docs/contracts.md");
console.log("Copied docs for the MCP server");
