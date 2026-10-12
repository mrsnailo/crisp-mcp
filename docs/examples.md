# Examples

Once configured in Claude Code or another MCP-compatible client, use natural language:

- "Show me unresolved support tickets"
- "What's the context of conversation session_abc123?"
- "Reply to that customer saying we're looking into it"
- "Mark that conversation as resolved"

## By tool

### List unresolved conversations

```
Use the list_conversations tool with unresolved_only: true
```

### Get a support ticket with full context

```
Use the get_conversation_with_messages tool with the session_id
```

Limit to recent messages (default window is 48h):

```
Use get_conversation_with_messages with session_id and max_age_hours: 24
```

### Reply to a customer

```
Use the send_message tool with session_id and content
```

### Add an internal note (not visible to customer)

```
Use the send_message tool with type: "note"
```

### Mention an operator (push/email notification)

Get the operator ID first, then mention with a note:

```
Use get_operators to find the operator user_id,
then send_message with type: "note", content, and mentions: ["<user_id>"]
```

### Tag a conversation

```
Use add_segments with session_id and segments: ["billing", "vip"]
```

### Assign a conversation

```
Use get_operators to find the user_id,
then assign_conversation with session_id and user_id
```

### Mark a ticket as resolved

```
Use the set_conversation_state tool with state: "resolved"
```

### Search the helpdesk knowledge base

Requires `LITELLM_API_KEY` and synced KB data (see [Tools Reference](tools-reference.md)):

```
Use search_knowledge_base with query: "how do I reset my password?" and max_results: 3
```

---
[Previous: Tools Reference](tools-reference.md) | [Home](../README.md) | [Next: Troubleshooting](troubleshooting.md)
