import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Create MCP server
const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// Temporary test tool
server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Health check tool",
    inputSchema: { msg: z.string().optional() }
  },
  async ({ msg }) => ({
    content: [{ type: "text", text: `pong${msg ? ": " + msg : ""}` }]
  })
);

// TODO: Import and register the actual WordPress tools from server.ts
// Example:
// import { registerWordPressTools } from "./server";
// registerWordPressTools(server);

const app = express();
app.use(express.json());
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

// Main MCP endpoint
app.all("/mcp", async (req: Request, res: Response) => {
  // ✅ pass an options object (even empty) — required by your SDK version
  const transport = new StreamableHTTPServerTransport({});

  // connect once per request
  await server.connect(transport);

  // handle this HTTP request
  await transport.handleRequest(req, res);
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`MCP Streamable HTTP server listening on port ${port} at /mcp`);
});
