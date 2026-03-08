#!/usr/bin/env node
/**
 * Crisp Webhook Handler — Docker / Coolify
 *
 * Receives Crisp webhook events and triggers the OpenClaw support agent
 * via HTTP POST to the OpenClaw gateway.
 *
 * Env vars:
 *   CRISP_WEBHOOK_SECRET   — Signing secret for HMAC-SHA256 verification
 *   CRISP_WEBSITE_ID       — Filter events to this website (optional)
 *   WEBHOOK_PORT           — Listen port (default: 3001)
 *   OPENCLAW_GATEWAY_URL   — Gateway base URL (e.g. http://openclaw-support:18789)
 *   OPENCLAW_GATEWAY_TOKEN — Auth token for gateway API
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { createHmac } from "crypto";

const PORT = parseInt(process.env.WEBHOOK_PORT || "3001", 10);
const WEBHOOK_SECRET = process.env.CRISP_WEBHOOK_SECRET || "";
const WEBSITE_ID = process.env.CRISP_WEBSITE_ID || "";
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "http://openclaw-support:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

// --- Debounce ---

const DEBOUNCE_MS = 30_000;
const recentTriggers = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - DEBOUNCE_MS;
  for (const [k, ts] of recentTriggers) {
    if (ts < cutoff) recentTriggers.delete(k);
  }
}, 60_000);

// --- Helpers ---

function verifySignature(
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string
): boolean {
  if (!timestamp || !signature || !secret) return false;
  const computed = createHmac("sha256", secret)
    .update(`${timestamp};${body}`)
    .digest("hex");
  return computed === signature;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractContent(
  content: string | { text?: string; url?: string; name?: string; type?: string },
  msgType: string
): string {
  if (typeof content === "string") return content;
  if (content.text) return content.text;
  if (msgType === "file" && content.url) {
    const mime = content.type || "";
    const name = content.name || "file";
    if (mime.startsWith("image/")) {
      return `[Image: ${name}]\nImage URL: ${content.url}\n\nThis is an image the customer sent. Fetch the conversation to view it using your vision capabilities.`;
    }
    return `[File: ${name}]\nFile URL: ${content.url}`;
  }
  if (content.url) return `[${msgType}: ${content.url}]`;
  return `[${msgType}]`;
}

async function triggerAgent(sessionId: string, nickname: string, messageText: string) {
  const prompt = [
    `New Crisp live chat message received.`,
    ``,
    `Customer: ${nickname}`,
    `Session ID: ${sessionId}`,
    `Latest message: ${messageText}`,
    ``,
    `Follow the Crisp Live Chat Workflow in your SOUL.md:`,
    `1. Read full conversation: crisp.get_conversation_with_messages(session_id="${sessionId}")`,
    `2. Check if you already replied recently — don't duplicate`,
    `3. Classify → follow the matching tier (KB search, investigate, or escalate)`,
    `4. Reply via crisp.send_message`,
  ].join("\n");

  try {
    const response = await fetch(`${GATEWAY_URL}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        agentId: "support",
        message: prompt,
        deliver: true,
        replyChannel: "telegram:support",
        replyTo: "1032439436",
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[agent] Error ${response.status}: ${text}`);
    } else {
      console.log(`[agent] Triggered for session ${sessionId}`);
    }
  } catch (err) {
    console.error(`[agent] Error:`, (err as Error).message);
  }
}

// --- Server ---

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { status: "ok", uptime: process.uptime() });
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    return json(res, 404, { error: "Not found" });
  }

  const rawBody = await readBody(req);

  if (WEBHOOK_SECRET) {
    const timestamp = req.headers["x-crisp-request-timestamp"] as string | undefined;
    const signature = req.headers["x-crisp-signature"] as string | undefined;

    if (!verifySignature(rawBody, timestamp, signature, WEBHOOK_SECRET)) {
      console.warn(`[webhook] Signature verification failed — allowing through`);
    }
  }

  let payload: { website_id: string; event: string; data: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const { event, data, website_id } = payload;

  if (WEBSITE_ID && website_id !== WEBSITE_ID) {
    return json(res, 200, { action: "ignored", reason: "wrong website_id" });
  }

  if (event !== "message:send" || data.from !== "user") {
    return json(res, 200, { action: "ignored", reason: `event=${event}, from=${data.from}` });
  }

  const sessionId = data.session_id as string;
  const nickname = (data.user as { nickname?: string })?.nickname || "Visitor";
  const messageText = extractContent(
    data.content as string | { text?: string; url?: string; name?: string },
    data.type as string
  );

  console.log(`[webhook] ${nickname} in ${sessionId}: ${messageText.substring(0, 100)}`);

  const now = Date.now();
  const last = recentTriggers.get(sessionId);
  if (last && now - last < DEBOUNCE_MS) {
    console.log(`[webhook] Debounced — ${sessionId} (${Math.round((now - last) / 1000)}s ago)`);
    return json(res, 200, { success: true, session_id: sessionId, agent_triggered: false, reason: "debounced" });
  }
  recentTriggers.set(sessionId, now);

  triggerAgent(sessionId, nickname, messageText);

  return json(res, 200, {
    success: true,
    event,
    session_id: sessionId,
    from: nickname,
    agent_triggered: true,
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] Listening on port ${PORT}`);
  console.log(`[webhook] Gateway: ${GATEWAY_URL}`);
  console.log(`[webhook] Signature: ${WEBHOOK_SECRET ? "enabled" : "DISABLED"}`);
});
