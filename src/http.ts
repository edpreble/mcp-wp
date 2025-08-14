import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
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

// TODO: Import & register the actual WordPress tools here once deploy is green
// Example:
// import { registerWpTools } from "./wp-tools";
// registerWpTools(server);

const app = express();
app.use(express.json());
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

app.all("/mcp", async (req: Request, res: Response) => {
  // Your SDK wants an options object with sessionIdGenerator
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`MCP Streamable HTTP server listening on port ${port} at /mcp`);
});
