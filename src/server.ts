// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Minimal server definition kept only so TypeScript builds cleanly.
 * Production traffic is handled by src/http.ts (Streamable HTTP).
 */

const server = new McpServer({ name: "mcp-wp", version: "0.0.3" });

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Health check tool",
    inputSchema: { msg: z.string().optional() },
  },
  async ({ msg }) => ({
    content: [{ type: "text", text: `pong${msg ? ": " + msg : ""}` }],
  })
);

// Export the instance for any local usage/tests; do not auto-start here.
export { server };
export default server;
