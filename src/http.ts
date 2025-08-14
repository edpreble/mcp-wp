import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// Minimal test tool
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

const app = express();
app.use(express.json({ limit: "2mb" }));

// Very permissive CORS for testing; we can tighten later.
app.use(
  cors({
    origin: true,              // reflect request origin
    credentials: true,
    exposedHeaders: ["mcp-session-id"],
  })
);

// Simple request logger
app.use((req, _res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.path} ua=${req.headers["user-agent"] ?? "-"}`
  );
  next();
});

// Health + root
app.get("/", (_req, res) => res.status(200).send("mcp-wp (Streamable HTTP) is running. Try POST /mcp"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Explicit preflight for /mcp
app.options("/mcp", (_req, res) => res.sendStatus(204));

// MCP endpoint
app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Log after response finishes to capture status
    res.on("finish", () => {
      console.log(
        `[${new Date().toISOString()}] DONE ${req.method} ${req.path} -> ${res.statusCode}`
      );
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    next(err);
  }
});

// Error handler to avoid crashes
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("Uncaught Exception:", e));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`✅ MCP Streamable HTTP server listening on port ${port} (/, /health, /mcp)`);
});
