#!/usr/bin/env node

/**
 * Crisp MCP Server — standalone HTTP transport
 *
 * Self-hosted alternative to the Vercel serverless deployment.
 * Runs as a persistent HTTP server with Bearer token auth.
 */

import { createServer as createHttpServer } from "http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CrispClient } from "./crisp-client.js";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.MCP_PORT || "3002", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

const CRISP_IDENTIFIER = process.env.CRISP_IDENTIFIER;
const CRISP_KEY = process.env.CRISP_KEY;
const CRISP_WEBSITE_ID = process.env.CRISP_WEBSITE_ID;

if (!CRISP_IDENTIFIER || !CRISP_KEY || !CRISP_WEBSITE_ID) {
  console.error(
    "Error: CRISP_IDENTIFIER, CRISP_KEY, and CRISP_WEBSITE_ID environment variables are required"
  );
  process.exit(1);
}

function authenticate(authHeader: string | undefined): boolean {
  if (!MCP_AUTH_TOKEN) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === MCP_AUTH_TOKEN;
}

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const httpServer = createHttpServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // Only accept POST /mcp
  if (req.method !== "POST" || (req.url !== "/mcp" && req.url !== "/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Auth
  if (!authenticate(req.headers.authorization)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      })
    );
    return;
  }

  // Create fresh MCP server + transport per request (stateless)
  const crispClient = new CrispClient({
    identifier: CRISP_IDENTIFIER,
    key: CRISP_KEY,
    websiteId: CRISP_WEBSITE_ID,
  });

  const litellmApiKey = process.env.LITELLM_API_KEY;
  const litellmBaseUrl =
    process.env.LITELLM_BASE_URL || "https://litellm.tubeonai.com/v1";

  const mcpServer = createServer(crispClient, {
    kb: litellmApiKey ? { litellmBaseUrl, litellmApiKey } : undefined,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);

  // Convert Node.js request to Web Request
  const body = await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
  }

  const webRequest = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body,
  });

  const webResponse = await transport.handleRequest(webRequest);

  // Write Web Response back to Node.js response
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  const responseBody = await webResponse.text();
  res.end(responseBody);
});

httpServer.listen(PORT, () => {
  console.log(`[crisp-mcp] HTTP MCP server listening on port ${PORT}`);
  console.log(`[crisp-mcp] Auth: ${MCP_AUTH_TOKEN ? "enabled" : "DISABLED"}`);
});
