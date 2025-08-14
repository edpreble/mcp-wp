import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// Simple test tool so you can call something via MCP
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

const app = express();
app.use(express.json());
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

// Basic root + health endpoints so Railway health checks pass
app.get("/", (_req, res) => {
  res.status(200).send("mcp-wp (Streamable HTTP) is running. Try POST /mcp");
});
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Streamable HTTP endpoint for MCP
app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    next(err);
  }
});

// Error handler (prevents process exit)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// Log unhandled promise rejections so the process doesn't die silently
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`✅ MCP Streamable HTTP server listening on port ${port} (/, /health, /mcp)`);
});
