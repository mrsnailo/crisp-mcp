# Tools Reference

Defined in `src/server.ts`. Most tools return JSON text (`get_conversation_with_messages` returns formatted plain text); failures return `{ "error": "<message>" }` with `isError: true`.

## Conversation Management

| Tool | Parameters | Notes |
|------|------------|-------|
| `list_conversations` | `page` (number, default `1`), `search` (string), `unresolved_only` (boolean, default `false`), `unread_only` (boolean, default `false`) | Maps to Crisp query params `search_query`, `filter_unresolved=1`, `filter_not_read=1` |
| `get_unresolved_conversations` | `max_pages` (number, default `5`) | Stops early on an empty page |
| `get_conversation` | `session_id` (required) | Returns the raw Crisp conversation object |
| `search_conversations` | `query` (required) | Same as `list_conversations` with `searchQuery` set |

List/search results are projected to summaries (`formatConversationSummary`): `session_id`, `state`, `customer` (`nickname`, `email`), `last_message`, `segments`, `unread` (operator count), `created_at`, `updated_at` (ISO).

## Messages

| Tool | Parameters | Notes |
|------|------------|-------|
| `get_messages` | `session_id` (required), `max_age_hours` (optional, default all) | Paginates up to 10 batches via `timestamp_before`, sorted oldest-first |
| `get_conversation_with_messages` | `session_id` (required), `max_age_hours` (default `48`) | Returns plain text: `=== CONVERSATION INFO ===` header (session, state, customer, email, segments) then timestamped `=== MESSAGES ===` lines |
| `send_message` | `session_id` + `content` (required), `type` (`text` \| `note`, default `text`), `nickname` (default `Support`), `avatar` (default TubeOnAI logo URL), `mentions` (operator `user_id` array, triggers push/email notifications; use with `note`) | Sends `from: operator`, `origin: chat`. Literal `\n` sequences in `content` are converted to real newlines. Returns `{ success: true, fingerprint }` |

## Conversation State

| Tool | Parameters | Notes |
|------|------------|-------|
| `set_conversation_state` | `session_id` + `state` (`pending` \| `unresolved` \| `resolved`, required) | `PATCH .../state` |
| `update_conversation_meta` | `session_id` (required), `email`, `nickname`, `subject`, `segments` | Only provided fields are sent; `PATCH .../meta` |
| `add_segments` | `session_id` + `segments` (required) | Reads current segments, merges, deduplicates, writes back |
| `remove_segments` | `session_id` + `segments` (required) | Reads current segments, filters out the given ones, writes back |

## Conversation Actions

| Tool | Parameters | Notes |
|------|------------|-------|
| `assign_conversation` | `session_id` + `user_id` (required) | `PATCH .../routing` with `{ assigned: { user_id } }`. Get IDs from `get_operators` |
| `block_conversation` | `session_id` (required) | `PATCH .../block` with `{ blocked: true }` |
| `unblock_conversation` | `session_id` (required) | `PATCH .../block` with `{ blocked: false }` |
| `delete_conversation` | `session_id` (required) | `DELETE`. Permanent, cannot be undone |

## Team & Visitors

| Tool | Parameters | Notes |
|------|------------|-------|
| `get_operators` | none | `GET /website/{id}/operators/list` |
| `get_visitors` | none | `GET /website/{id}/visitors/list` (currently browsing) |

## Knowledge Base

`search_knowledge_base` is implemented in code (`src/server.ts`, `src/kb-search.ts`) but not listed in the README.

| Tool | Parameters | Notes |
|------|------------|-------|
| `search_knowledge_base` | `query` (required), `max_results` (default `3`) | Requires `LITELLM_API_KEY` plus KB data (`KB_BLOB_URL` or `data/kb-embeddings.json`, cached 10 min). Embeds the query with the KB's stored model, ranks chunks by cosine similarity, dedupes by article title. Returns `rank`, `title`, `category`, `url`, `relevance` (%), `excerpt` per hit |

Build the KB data with `npm run kb:sync` (needs `CRISP_*` + `LITELLM_API_KEY`; fetches published English helpdesk articles, chunks to ~1500 chars, embeds via `azure/text-embedding-3-small` in batches of 20, writes `data/kb-embeddings.json`). On Vercel, `GET /api/kb-sync` runs the same sync daily via cron (`vercel.json`, `0 0 * * *`, `maxDuration: 300`) and stores the JSON in Vercel Blob; auth is `CRON_SECRET` or `MCP_AUTH_TOKEN` Bearer.

## Resources

| URI | Description |
|-----|-------------|
| `crisp://conversations/unresolved` | Same summary shape as list results; reader fetches 5 pages (`src/server.ts`) |

---
[Previous: Configuration](configuration.md) | [Home](../README.md) | [Next: Examples](examples.md)
