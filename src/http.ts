// src/http.ts
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// --- 1) Build the SAME tools this project already exposes ---
// Import the code that registers tools against a shared server instance.
// If mcp-wp builds tools via functions/modules, require those here and call them
// to register on `server`. (Fallback demo tool shown so this compiles.)
const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// DEMO tool (keep or delete after wiring the real tools):
server.registerTool(
  "ping",
  { title: "Ping", description: "Health check", inputSchema: { msg: z.string().optional() } },
  async ({ msg }) => ({ content: [{ type: "text", text: `pong${msg ? ": " + msg : ""}` }] })
);

// TODO: import and call the project’s tool registration here.
// Example (adjust to the repo’s structure):
// import { registerAllWordPressTools } from "./tools";
// registerAllWordPressTools(server);

// --- 2) HTTP app & transport wiring ---
const app = express();
app.use(express.json());
// CORS is important so browser-based clients (and some tool UIs) can read headers like MCP session id
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

// Single Streamable HTTP endpoint (recommended path: /mcp)
app.all("/mcp", async (req, res) => {
  // One transport per request; the SDK handles POST + optional SSE streaming
  const transport = new StreamableHTTPServerTransport();
  await server.connect(transport);

  // The SDK provides helper methods to process the incoming request
  // and write the response according to the Streamable HTTP spec.
  await transport.handleRequest(req, res);
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => console.log(`MCP Streamable HTTP server on :${port} (path /mcp)`));
