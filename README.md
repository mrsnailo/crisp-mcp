# Crisp MCP Server

An MCP (Model Context Protocol) server that provides tools for interacting with the [Crisp](https://crisp.chat) customer support platform. Use it with Claude Code or any MCP-compatible client to manage support conversations, send messages, and more.

## Installation

```bash
git clone https://github.com/mrsnailo/crisp-mcp.git
cd crisp-mcp
npm install
npm run build
```

## Getting Your Crisp API Credentials

You'll need to create a Crisp Marketplace plugin to get API credentials. Here's how:

### Step 1: Access the Marketplace

1. Go to [Crisp Marketplace](https://marketplace.crisp.chat/)
2. Click **"Create a Plugin"** (you need a Crisp account)

### Step 2: Create Your Plugin

1. Fill in the basic plugin info:
   - **Name**: Something like "My MCP Integration" (only visible to you)
   - **Description**: "Personal MCP server integration"
   - **Category**: Select "Automation"
   - **Privacy**: Keep it private (unless you want to publish)

2. Click **"Create Plugin"**

### Step 3: Get Your Credentials

After creating the plugin:

1. Go to your plugin's settings page
2. Navigate to the **"Tokens"** section
3. You'll find:
   - **Plugin ID** (this is your `CRISP_IDENTIFIER`)
   - **Plugin Secret Key** (this is your `CRISP_KEY`)

### Step 4: Get Your Website ID

1. Go to your [Crisp Dashboard](https://app.crisp.chat/)
2. Click on **Settings** (gear icon)
3. Go to **Website Settings**
4. Your **Website ID** is in the URL: `app.crisp.chat/website/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX/`
5. Or find it under **Setup Instructions** > **Website ID**

### Step 5: Configure Plugin Permissions

Back in the Marketplace plugin settings, you need to enable the required scopes:

1. Go to your plugin's **"Permissions"** tab
2. Enable these scopes:
   - `website:conversation:sessions` - Read conversations
   - `website:conversation:messages` - Read/write messages
   - `website:conversation:states` - Change conversation states
   - `website:conversation:routing` - Assign conversations
   - `website:conversation:metas` - Read/write metadata
   - `website:operators:list` - List team members
   - `website:visitors:list` - List visitors

3. Click **"Save"**

### Step 6: Install Plugin on Your Website

1. Go to the **"Installations"** tab in your plugin settings
2. Click **"Add Installation"**
3. Select your website
4. Confirm the installation

You're now ready to use the MCP server!

## Configuration

Set these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `CRISP_IDENTIFIER` | Your plugin ID from Marketplace | `ab1c2d3e-4f5g-6h7i-8j9k-0l1m2n3o4p5q` |
| `CRISP_KEY` | Your plugin secret key | `a1b2c3d4e5f6...` (long string) |
| `CRISP_WEBSITE_ID` | Your website ID | `12345678-1234-1234-1234-123456789012` |

## Usage with Claude Code

Add this to your Claude Code MCP settings (`~/.claude/settings.json`):

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

Then restart Claude Code. You can now use natural language to manage your Crisp conversations:

- "Show me unresolved support tickets"
- "What's the context of conversation session_abc123?"
- "Reply to that customer saying we're looking into it"
- "Mark that conversation as resolved"

## Available Tools

### Conversation Management

| Tool | Description |
|------|-------------|
| `list_conversations` | List conversations with optional filtering (page, search, unresolved, unread) |
| `get_unresolved_conversations` | Get all unresolved conversations (paginated) |
| `get_conversation` | Get detailed info about a specific conversation |
| `search_conversations` | Search conversations by text query |

### Messages

| Tool | Description |
|------|-------------|
| `get_messages` | Get messages from a conversation |
| `get_conversation_with_messages` | Get conversation and messages formatted for analysis |
| `send_message` | Send a message (text or internal note) to a conversation |

### Conversation State

| Tool | Description |
|------|-------------|
| `set_conversation_state` | Change state (pending, unresolved, resolved) |
| `update_conversation_meta` | Update metadata (email, nickname, subject, segments) |
| `add_segments` | Add tags/segments to a conversation |
| `remove_segments` | Remove tags/segments from a conversation |

### Conversation Actions

| Tool | Description |
|------|-------------|
| `assign_conversation` | Assign to a specific operator |
| `block_conversation` | Block a conversation |
| `unblock_conversation` | Unblock a conversation |
| `delete_conversation` | Permanently delete a conversation |

### Team & Visitors

| Tool | Description |
|------|-------------|
| `get_operators` | Get list of support team operators |
| `get_visitors` | Get list of current website visitors |

## Available Resources

| URI | Description |
|-----|-------------|
| `crisp://conversations/unresolved` | List of all unresolved support conversations |

## Examples

### List unresolved conversations

```
Use the list_conversations tool with unresolved_only: true
```

### Get a support ticket with full context

```
Use the get_conversation_with_messages tool with the session_id
```

### Reply to a customer

```
Use the send_message tool with session_id and content
```

### Add an internal note (not visible to customer)

```
Use the send_message tool with type: "note"
```

### Mark a ticket as resolved

```
Use the set_conversation_state tool with state: "resolved"
```

## Development

```bash
# Watch mode for development
npm run dev

# Build for production
npm run build

# Run the server directly
npm start
```

## Troubleshooting

### "Crisp API error: 401 Unauthorized"
- Check that your `CRISP_IDENTIFIER` and `CRISP_KEY` are correct
- Make sure you've installed the plugin on your website

### "Crisp API error: 403 Forbidden"
- Your plugin may be missing required permissions
- Go to Marketplace > Your Plugin > Permissions and enable the necessary scopes

### "Website not found"
- Double-check your `CRISP_WEBSITE_ID`
- Make sure the plugin is installed on that specific website

## License

MIT
