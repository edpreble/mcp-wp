// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Minimal stdio server kept only so TypeScript build succeeds.
 * Your production app uses the HTTP server in src/http.ts.
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

// If someone runs the CLI (stdio) locally, this will work.
// On Railway we start the HTTP transport via `npm run start:http`.
if (import.meta.main) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await transport.start();
}

export { server };
