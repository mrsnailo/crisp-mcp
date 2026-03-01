/**
 * Crisp MCP Server — Vercel serverless HTTP transport
 *
 * Stateless mode: each request creates a fresh server + transport.
 * Auth via Bearer token in Authorization header.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CrispClient } from "../src/crisp-client.js";
import { createServer } from "../src/server.js";

export const config = { supportsResponseStreaming: true };

function authenticate(request: Request): boolean {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  return authHeader.slice(7) === token;
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

function getCrispClient(): CrispClient {
  const identifier = process.env.CRISP_IDENTIFIER;
  const key = process.env.CRISP_KEY;
  const websiteId = process.env.CRISP_WEBSITE_ID;

  if (!identifier || !key || !websiteId) {
    throw new Error(
      "CRISP_IDENTIFIER, CRISP_KEY, and CRISP_WEBSITE_ID environment variables are required"
    );
  }

  return new CrispClient({ identifier, key, websiteId });
}

async function handleRequest(request: Request): Promise<Response> {
  if (!authenticate(request)) {
    return unauthorizedResponse();
  }

  // Stateless mode: no session persistence across invocations
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const crispClient = getCrispClient();
  const server = createServer(crispClient);
  await server.connect(transport);

  return transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  if (!authenticate(request)) {
    return unauthorizedResponse();
  }
  return new Response("Method not allowed in stateless mode", { status: 405 });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!authenticate(request)) {
    return unauthorizedResponse();
  }
  return new Response("Method not allowed in stateless mode", { status: 405 });
}
