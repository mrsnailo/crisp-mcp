/**
 * Crisp Webhook Endpoint
 *
 * Receives real-time events from Crisp (message:send, etc.)
 * and forwards customer messages to the support agent via Telegram.
 *
 * Env vars:
 *   CRISP_WEBHOOK_SECRET  — Crisp plugin secret for HMAC-SHA256 verification
 *   TELEGRAM_BOT_TOKEN    — Support bot token
 *   TELEGRAM_CHAT_ID      — Shahid's Telegram user ID (receives notifications)
 *   CRISP_WEBSITE_ID      — To filter events for the correct website
 */

import { createHmac } from "crypto";

export const config = { maxDuration: 10 };

// --- Types ---

interface WebhookPayload {
  website_id: string;
  event: string;
  data: MessageEventData & Record<string, unknown>;
  timestamp: number;
}

interface MessageEventData {
  session_id: string;
  website_id: string;
  type: string;
  from: string;
  origin: string;
  content: string | { text?: string; url?: string; name?: string };
  user?: { user_id?: string; nickname?: string };
  timestamp: number;
  fingerprint: number;
}

// --- Signature verification ---

function verifySignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
  secret: string
): boolean {
  if (!timestamp || !signature) return false;
  const signatureString = `${timestamp};${body}`;
  const computed = createHmac("sha256", secret)
    .update(signatureString)
    .digest("hex");
  return computed === signature;
}

// --- Telegram notification ---

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    }
  );
  return response.ok;
}

// --- Extract text content ---

function extractContent(
  content: string | { text?: string; url?: string; name?: string },
  type: string
): string {
  if (typeof content === "string") return content;
  if (content.text) return content.text;
  if (type === "file" && content.name) return `[File: ${content.name}]`;
  if (content.url) return `[${type}: ${content.url}]`;
  return `[${type}]`;
}

// --- Main handler ---

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.CRISP_WEBHOOK_SECRET;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const expectedWebsiteId = process.env.CRISP_WEBSITE_ID;

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify signature if secret is configured
  if (webhookSecret) {
    const timestamp = request.headers.get("x-crisp-request-timestamp");
    const signature = request.headers.get("x-crisp-signature");

    if (!verifySignature(rawBody, timestamp, signature, webhookSecret)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { event, data, website_id } = payload;

  // Filter by website ID if configured
  if (expectedWebsiteId && website_id !== expectedWebsiteId) {
    return new Response(
      JSON.stringify({ action: "ignored", reason: "wrong website_id" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Only handle user messages (not operator messages or notes)
  if (event !== "message:send" || data.from !== "user") {
    return new Response(
      JSON.stringify({ action: "ignored", reason: `event=${event}, from=${data.from}` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extract message details
  const sessionId = data.session_id;
  const nickname = data.user?.nickname || "Visitor";
  const messageText = extractContent(data.content, data.type);
  const truncated =
    messageText.length > 500
      ? messageText.substring(0, 500) + "..."
      : messageText;

  // Build notification
  const notification = [
    `💬 *New Crisp message*`,
    `*From:* ${nickname}`,
    `*Message:* ${truncated}`,
    `*Session:* \`${sessionId}\``,
    ``,
    `Use \`mcporter call crisp.get_conversation_with_messages session_id="${sessionId}"\` to read the full conversation and reply.`,
  ].join("\n");

  // Send to Telegram
  let delivered = false;
  if (botToken && chatId) {
    delivered = await sendTelegram(botToken, chatId, notification);
  }

  return new Response(
    JSON.stringify({
      success: true,
      event,
      session_id: sessionId,
      from: nickname,
      delivered,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
