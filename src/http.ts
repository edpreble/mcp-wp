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

// ⚠️ Do NOT use express.json() on /mcp — the MCP transport reads the raw body itself.
// Keep CORS, health endpoints, logging, and negotiation helpers.

app.use(
  cors({
    origin: true,
    credentials: true,
    // IMPORTANT: expose the EXACT session header so browser/Electron clients (Inspector, n8n UI) can read it
    exposedHeaders: ["Mcp-Session-Id"],
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

// Request logger (logs Accept + UA + final status)
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

// Main MCP endpoint — let the MCP transport read the raw request stream
app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    next(err);
  }
});

// Error handler (prevents crashes and surfaces messages)
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
