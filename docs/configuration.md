# Configuration

## Required

All three transports (`src/index.ts`, `src/http-server.ts`, `api/mcp.ts`) exit or throw if any of these are missing:

| Variable | Description | Example |
|----------|-------------|---------|
| `CRISP_IDENTIFIER` | Plugin ID from Marketplace | `ab1c2d3e-4f5g-6h7i-8j9k-0l1m2n3o4p5q` |
| `CRISP_KEY` | Plugin secret key | `a1b2c3d4e5f6...` (long string) |
| `CRISP_WEBSITE_ID` | Website ID | `12345678-1234-1234-1234-123456789012` |

Auth uses `Basic base64(identifier:key)` with header `X-Crisp-Tier: plugin` (`src/crisp-client.ts`).

## Optional

| Variable | Default | Enables / used by |
|----------|---------|-------------------|
| `LITELLM_API_KEY` | unset (KB tool disabled) | `search_knowledge_base` in `src/index.ts`, `src/http-server.ts`, `api/mcp.ts` |
| `LITELLM_BASE_URL` | `https://litellm.tubeonai.com/v1` | Embedding/query requests in `src/kb-search.ts`, `src/kb-sync.ts` |
| `KB_BLOB_URL` | unset (falls back to `data/kb-embeddings.json`) | KB data source in `src/kb-search.ts` |
| `MCP_AUTH_TOKEN` | unset | Bearer auth for `src/http-server.ts` and `api/mcp.ts`; manual trigger auth for `api/kb-sync.ts` |
| `MCP_PORT` | `3002` | Listen port in `src/http-server.ts` |
| `CRON_SECRET` | unset | Vercel cron auth for `GET /api/kb-sync` |
| `CRISP_WEBHOOK_SECRET` | unset (verification skipped with a warning) | HMAC-SHA256 verification in `api/webhook.ts`, `src/local-webhook.ts` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | unset (notification not delivered) | Telegram forward in `api/webhook.ts` |
| `WEBHOOK_PORT` | `3001` | Listen port in `src/local-webhook.ts` |

## Get credentials

You need a Crisp Marketplace plugin:

### 1. Access the Marketplace

1. Go to [Crisp Marketplace](https://marketplace.crisp.chat/)
2. Click **"Create a Plugin"** (requires a Crisp account)

### 2. Create the plugin

1. Fill in the basic info:
   - **Name**: e.g. "My MCP Integration" (only visible to you)
   - **Description**: "Personal MCP server integration"
   - **Category**: "Automation"
   - **Privacy**: private (unless you want to publish)
2. Click **"Create Plugin"**

### 3. Get identifier and key

1. Open the plugin settings page
2. Go to the **"Tokens"** section
3. Copy:
   - **Plugin ID** → `CRISP_IDENTIFIER`
   - **Plugin Secret Key** → `CRISP_KEY`

### 4. Get the Website ID

1. Go to the [Crisp Dashboard](https://app.crisp.chat/)
2. Click **Settings** (gear icon) → **Website Settings**
3. The Website ID is in the URL: `app.crisp.chat/website/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX/`
4. Alternatively find it under **Setup Instructions** > **Website ID**

### 5. Configure permissions

In the plugin settings, open the **"Permissions"** tab and enable:

- `website:conversation:sessions` - Read conversations
- `website:conversation:messages` - Read/write messages
- `website:conversation:states` - Change conversation states
- `website:conversation:routing` - Assign conversations
- `website:conversation:metas` - Read/write metadata
- `website:operators:list` - List team members
- `website:visitors:list` - List visitors

Click **"Save"**.

### 6. Install the plugin on your website

1. Go to the **"Installations"** tab in plugin settings
2. Click **"Add Installation"**
3. Select your website
4. Confirm

---
[Previous: Installation](installation.md) | [Home](../README.md) | [Next: Tools Reference](tools-reference.md)
