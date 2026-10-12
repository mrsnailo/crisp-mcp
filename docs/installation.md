# Installation

Requirements: Node.js >= 18 (`package.json` engines), npm.

```bash
git clone https://github.com/mrsnailo/crisp-mcp.git
cd crisp-mcp
npm install
npm run build
```

| Script | Command | Source |
|--------|---------|--------|
| Build | `npm run build` (`tsc`) | `package.json` |
| Watch mode | `npm run dev` (`tsc --watch`) | `package.json` |
| Run stdio server | `npm start` (`node dist/index.js`) | `package.json` |
| Sync knowledge base | `npm run kb:sync` (`tsx src/kb-sync.ts`) | `package.json` |

## Transports

The repo ships three ways to run the same tool set (`src/server.ts` factory):

1. **stdio** — `src/index.ts`. Entry point after build is `dist/index.js`. Used by Claude Code and other MCP-compatible clients. Exits with an error if `CRISP_IDENTIFIER`, `CRISP_KEY`, or `CRISP_WEBSITE_ID` are missing.
2. **Standalone HTTP** — `src/http-server.ts`. Self-hosted persistent server. Listens on `MCP_PORT` (default `3002`). Requires `MCP_AUTH_TOKEN` (Bearer auth; requests without a matching token get `401 Unauthorized`). Routes: `GET /health` (status/uptime, no auth), `POST /mcp` and `POST /` (MCP, authenticated).
3. **Vercel serverless** — `api/mcp.ts`. Stateless (fresh server + transport per request, `sessionIdGenerator: undefined`). Bearer auth via `MCP_AUTH_TOKEN`. Only `POST` is served; `GET`/`DELETE` return `405 Method not allowed in stateless mode`. `maxDuration: 60` (`vercel.json`).

## Usage with Claude Code (stdio)

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "crisp": {
      "command": "node",
      "args": ["/path/to/crisp-mcp/dist/index.js"],
      "env": {
        "CRISP_IDENTIFIER": "your-plugin-id",
        "CRISP_KEY": "your-plugin-secret-key",
        "CRISP_WEBSITE_ID": "your-website-id"
      }
    }
  }
}
```

Restart Claude Code after saving. See [Configuration](configuration.md) for where the values come from, including the optional `LITELLM_*` variables that enable the knowledge-base tool.

---
[Home](../README.md) | [Next: Configuration](configuration.md)
