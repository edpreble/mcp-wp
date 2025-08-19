import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * MCP server setup
 */
const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// Minimal test tool so you can verify end-to-end calls
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

/**
 * HTTP app
 */
const app = express();

// ⚠️ Do NOT add express.json() on /mcp — the MCP transport reads the raw body itself.

// Permissive CORS; expose both casings of the session header so clients can read it
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id"],
  })
);

// Root + health for Railway and quick checks
app.get("/", (_req, res) =>
  res.status(200).send("mcp-wp (Streamable HTTP) is running. Try POST /mcp")
);
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Preflight for /mcp
app.options("/mcp", (_req, res) => res.sendStatus(204));

/**
 * Normalize negotiation to avoid 406s:
 * - Allow both JSON and SSE.
 */
app.use("/mcp", (req, _res, next) => {
  req.headers["accept"] = "application/json, text/event-stream";
  next();
});

/**
 * Normalize inbound session header casing so the transport can find it.
 */
app.use("/mcp", (req, _res, next) => {
  const sid =
    (req.headers["mcp-session-id"] as string | undefined) ??
    (req.headers["Mcp-Session-Id" as any] as string | undefined) ??
    (req.get && req.get("Mcp-Session-Id")) ??
    (req.get && req.get("mcp-session-id"));
  if (sid) {
    (req.headers as any)["mcp-session-id"] = sid;
    (req.headers as any)["Mcp-Session-Id"] = sid;
  }
  next();
});

// Simple request logger
app.use((req, res, next) => {
  const started = new Date();
  const ua = req.headers["user-agent"] ?? "-";
  const accept = req.headers["accept"] ?? "-";
  console.log(`[${started.toISOString()}] ${req.method} ${req.path} ua=${ua} accept=${accept}`);
  res.on("finish", () => {
    const ended = new Date();
    console.log(`[${ended.toISOString()}] DONE ${req.method} ${req.path} -> ${res.statusCode}`);
  });
  next();
});

/**
 * ✅ SINGLETON TRANSPORT
 * Create one transport and reuse it across all requests so session state persists.
 */
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// Connect the server to the transport once at startup
await server.connect(transport);

// Main MCP endpoint — reuse the singleton transport for each request
app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// Safety nets
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("Uncaught Exception:", e));

// Start
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`✅ MCP Streamable HTTP server listening on port ${port} (/, /health, /mcp)`);
});
