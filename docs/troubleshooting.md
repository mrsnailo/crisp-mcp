# Troubleshooting

### "Error: CRISP_IDENTIFIER, CRISP_KEY, and CRISP_WEBSITE_ID environment variables are required"

- Thrown at startup by `src/index.ts`, `src/http-server.ts`, and `api/mcp.ts` when any of the three is missing. Check env or the `env` block in `~/.claude/settings.json` (see [Configuration](configuration.md)).

### "Crisp API error: 401 Unauthorized"

- Check that `CRISP_IDENTIFIER` and `CRISP_KEY` are correct
- Make sure the plugin is installed on your website (see [Configuration](configuration.md))

### "Crisp API error: 403 Forbidden"

- The plugin may be missing required permissions
- Go to Marketplace > Your Plugin > Permissions and enable the necessary scopes (see [Configuration](configuration.md))

### "Website not found"

- Double-check `CRISP_WEBSITE_ID`
- Make sure the plugin is installed on that specific website

### HTTP transport returns `401 Unauthorized` / `{"code": -32001}`

- `src/http-server.ts` and `api/mcp.ts` require a matching `MCP_AUTH_TOKEN` Bearer token. If the token is unset server-side, all requests are rejected.

### HTTP `GET`/`DELETE` returns `405 Method not allowed in stateless mode`

- Expected on the Vercel deployment (`api/mcp.ts`): only `POST` serves MCP in stateless mode.

### "Knowledge base search is not configured. Set LITELLM_API_KEY and LITELLM_BASE_URL."

- `search_knowledge_base` needs `LITELLM_API_KEY` (see [Configuration](configuration.md)).

### "Knowledge base not available. Run kb-sync or set KB_BLOB_URL."

- No KB data found. Run `npm run kb:sync` to generate `data/kb-embeddings.json`, or set `KB_BLOB_URL` to the Vercel Blob JSON (produced by `GET /api/kb-sync`).

### "Embedding API error {status}: ..."

- The LiteLLM endpoint (`LITELLM_BASE_URL`) rejected the embedding request. Check the API key, base URL, and that the `azure/text-embedding-3-small` model is available.

### Webhook events ignored (`action: "ignored"`)

- `wrong website_id`: `CRISP_WEBSITE_ID` doesn't match the event's `website_id` (`api/webhook.ts`, `src/local-webhook.ts`).
- `event=...`: only `message:send` events with `from: "user"` are handled; operator messages and other event types are skipped by design.
- `debounced` (`src/local-webhook.ts` only): same session triggered within the 30s window.

---
[Previous: Examples](examples.md) | [Home](../README.md)
