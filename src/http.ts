import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import axios, { AxiosInstance } from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** ───────── WordPress client (optional; safe to keep even if you haven’t set WP env yet) */
function makeWpClient(): AxiosInstance {
  const baseURL = process.env.WORDPRESS_API_URL?.replace(/\/+$/, "");
  const username = process.env.WORDPRESS_USERNAME;
  const password = process.env.WORDPRESS_PASSWORD;

  const auth = Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64");
  const client = axios.create({
    baseURL: baseURL ? `${baseURL}/wp-json/wp/v2` : undefined,
    headers: {
      "User-Agent": "mcp-wp/streamable-http",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    timeout: 30_000,
    validateStatus: () => true,
  });
  return client;
}
const wp = makeWpClient();

/** ───────── MCP server & a few tools */
const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

// Keep ping for quick checks
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

/** (You can add the WordPress tools later; they’re not involved in this session lock fix.) */

/** ───────── HTTP app (Streamable HTTP transport, singleton) */
const app = express();

// DO NOT add express.json() on /mcp — transport needs the raw body.

app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id"],
  })
);

app.get("/", (_req, res) =>
  res.status(200).send("mcp-wp (Streamable HTTP) is running. Try POST /mcp")
);
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.options("/mcp", (_req, res) => res.sendStatus(204));

/** ---- NEW: simple bearer auth to prevent “mystery client” from stealing the session */
const TOKEN = process.env.MCP_BEARER_TOKEN?.trim();
app.use("/mcp", (req, res, next) => {
  if (!TOKEN) return next(); // open during local testing if no token is set
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

/** Content negotiation: allow JSON or SSE */
app.use("/mcp", (req, _res, next) => {
  req.headers["accept"] = "application/json, text/event-stream";
  next();
});

/** Normalize session header casing */
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

// Logs
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

// ✅ SINGLETON transport so sessions persist
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

// /mcp endpoint
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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`✅ MCP Streamable HTTP server listening on port ${port} (/, /health, /mcp)`);
});
