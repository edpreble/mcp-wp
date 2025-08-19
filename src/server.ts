import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import axios, { AxiosInstance } from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * ──────────────────────────────────────────────────────────────────────────────
 *  WordPress client (simple, self-contained)
 * ──────────────────────────────────────────────────────────────────────────────
 */
function makeWpClient(): AxiosInstance {
  const baseURL = process.env.WORDPRESS_API_URL?.replace(/\/+$/, "");
  const username = process.env.WORDPRESS_USERNAME;
  const password = process.env.WORDPRESS_PASSWORD;

  if (!baseURL || !username || !password) {
    console.warn(
      "⚠️  Missing WordPress env vars. Set WORDPRESS_API_URL, WORDPRESS_USERNAME, WORDPRESS_PASSWORD in Railway → Variables."
    );
  }

  const auth = Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64");

  const client = axios.create({
    baseURL: baseURL ? `${baseURL}/wp-json/wp/v2` : undefined,
    headers: {
      "User-Agent": "mcp-wp/streamable-http",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    timeout: 30_000,
    // WordPress returns JSON
    validateStatus: () => true, // we’ll handle status manually to surface errors cleanly
  });

  return client;
}

const wp = makeWpClient();

/**
 * ──────────────────────────────────────────────────────────────────────────────
 *  MCP server & tools
 * ──────────────────────────────────────────────────────────────────────────────
 */
const server = new McpServer({ name: "mcp-wp", version: "1.0.0" });

/** Helpers */
const ContentTypeEnum = z.enum(["post", "page"]); // keep it simple; you can add custom types later
const IdSchema = z.union([z.string(), z.number()]).transform((v) => Number(v));

function wpCheck(resp: any, action: string) {
  const status = resp?.status ?? 0;
  if (status >= 200 && status < 300) return;
  const msg =
    resp?.data?.message ||
    resp?.statusText ||
    `WordPress ${action} failed with status ${status}`;
  const detail = (resp?.data && JSON.stringify(resp.data)) || "";
  throw new Error(`${msg}${detail ? ` – ${detail}` : ""}`);
}

/**
 * list_content
 * - type: "post" | "page"
 * - page, per_page, search
 */
server.registerTool(
  "list_content",
  {
    title: "List posts/pages",
    description:
      "List WordPress content. Supports type=post|page, pagination, and search.",
    inputSchema: {
      type: ContentTypeEnum.default("post"),
      page: z.number().int().positive().default(1).optional(),
      per_page: z.number().int().positive().max(100).default(10).optional(),
      search: z.string().min(1).optional(),
      status: z.enum(["publish", "draft", "pending", "private"]).optional(),
    },
  },
  async ({ type = "post", page = 1, per_page = 10, search, status }) => {
    const params: Record<string, any> = { page, per_page, _embed: true };
    if (search) params.search = search;
    if (status) params.status = status;

    const resp = await wp.get(`/${type}`, { params });
    wpCheck(resp, "list");

    const items = (resp.data as any[]).map((p: any) => ({
      id: p.id,
      type,
      title: p.title?.rendered ?? "",
      slug: p.slug,
      status: p.status,
      link: p.link,
      date: p.date,
    }));

    return { content: [{ type: "json", json: { items, total: Number(resp.headers["x-wp-total"] || items.length) } }] };
  }
);

/**
 * get_content
 * - type: "post" | "page"
 * - id: number
 */
server.registerTool(
  "get_content",
  {
    title: "Get a single post/page",
    description: "Fetch a single WordPress post or page by numeric ID.",
    inputSchema: { type: ContentTypeEnum, id: IdSchema },
  },
  async ({ type, id }) => {
    const resp = await wp.get(`/${type}/${id}`, { params: { _embed: true } });
    wpCheck(resp, "get");

    return { content: [{ type: "json", json: resp.data }] };
  }
);

/**
 * create_content
 * - type: "post" | "page"
 * - title: string
 * - content: string (HTML or text)
 * - status: publish|draft|pending|private (default: draft)
 */
server.registerTool(
  "create_content",
  {
    title: "Create a post/page",
    description:
      "Create a WordPress post or page. Defaults to draft if no status is provided.",
    inputSchema: {
      type: ContentTypeEnum,
      title: z.string().min(1),
      content: z.string().min(1),
      status: z.enum(["publish", "draft", "pending", "private"]).default("draft").optional(),
      slug: z.string().min(1).optional(),
    },
  },
  async ({ type, title, content, status = "draft", slug }) => {
    const body: Record<string, any> = { title, content, status };
    if (slug) body.slug = slug;

    const resp = await wp.post(`/${type}`, body);
    wpCheck(resp, "create");

    return { content: [{ type: "json", json: resp.data }] };
  }
);

/**
 * update_content
 * - type: "post" | "page"
 * - id: number
 * - title/content/status/slug (any subset)
 */
server.registerTool(
  "update_content",
  {
    title: "Update a post/page",
    description: "Update fields on an existing WordPress post or page.",
    inputSchema: {
      type: ContentTypeEnum,
      id: IdSchema,
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      status: z.enum(["publish", "draft", "pending", "private"]).optional(),
      slug: z.string().min(1).optional(),
    },
  },
  async ({ type, id, title, content, status, slug }) => {
    const patch: Record<string, any> = {};
    if (title) patch.title = title;
    if (content) patch.content = content;
    if (status) patch.status = status;
    if (slug) patch.slug = slug;

    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update. Provide at least one field.");
    }

    const resp = await wp.post(`/${type}/${id}`, patch);
    wpCheck(resp, "update");

    return { content: [{ type: "json", json: resp.data }] };
  }
);

/**
 * delete_content
 * - type: "post" | "page"
 * - id: number
 * - force: boolean (default true → hard delete)
 */
server.registerTool(
  "delete_content",
  {
    title: "Delete a post/page",
    description:
      "Delete a WordPress post or page. By default uses force=true (hard delete).",
    inputSchema: {
      type: ContentTypeEnum,
      id: IdSchema,
      force: z.boolean().default(true).optional(),
    },
  },
  async ({ type, id, force = true }) => {
    const resp = await wp.delete(`/${type}/${id}`, { params: { force } });
    wpCheck(resp, "delete");

    return { content: [{ type: "json", json: resp.data }] };
  }
);

/**
 * Keep your existing ping for quick checks
 */
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
 * ──────────────────────────────────────────────────────────────────────────────
 *  HTTP app (Streamable HTTP transport) — singleton transport
 * ──────────────────────────────────────────────────────────────────────────────
 */
const app = express();

// DO NOT use express.json() on /mcp — the transport needs the raw body.

// CORS: allow clients to read the MCP session id header
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id"],
  })
);

// Basic root + health
app.get("/", (_req, res) =>
  res.status(200).send("mcp-wp (Streamable HTTP) is running. Try POST /mcp")
);
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Preflight for /mcp
app.options("/mcp", (_req, res) => res.sendStatus(204));

// Negotiate JSON or SSE (support both)
app.use("/mcp", (req, _res, next) => {
  req.headers["accept"] = "application/json, text/event-stream";
  next();
});

// Normalize session header casing (clients vary)
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

// Simple logs
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

// ✅ SINGLETON transport so sessions persist between requests
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// Connect once at startup
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

// Start
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`✅ MCP Streamable HTTP server listening on port ${port} (/, /health, /mcp)`);
});
