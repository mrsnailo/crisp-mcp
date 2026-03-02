/**
 * Crisp MCP Server Factory
 *
 * Shared server setup used by both stdio (index.ts) and HTTP (api/mcp.ts) transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { CrispClient, Conversation } from "./crisp-client.js";
import { searchKnowledgeBase, getKBStatus, KBSearchConfig } from "./kb-search.js";

// Define available tools
const tools: Tool[] = [
  {
    name: "list_conversations",
    description:
      "List conversations from Crisp with optional filtering. Returns a list of conversation summaries.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)",
        },
        search: {
          type: "string",
          description: "Search query to filter conversations",
        },
        unresolved_only: {
          type: "boolean",
          description: "Only return unresolved conversations (default: false)",
        },
        unread_only: {
          type: "boolean",
          description: "Only return unread conversations (default: false)",
        },
      },
    },
  },
  {
    name: "get_unresolved_conversations",
    description:
      "Get all unresolved conversations. Useful for seeing open support tickets that need attention.",
    inputSchema: {
      type: "object",
      properties: {
        max_pages: {
          type: "number",
          description: "Maximum pages to fetch (default: 5)",
        },
      },
    },
  },
  {
    name: "get_conversation",
    description:
      "Get detailed information about a specific conversation by its session ID.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_messages",
    description:
      "Get messages from a conversation. Returns the message history.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        max_age_hours: {
          type: "number",
          description:
            "Only get messages from the last N hours (optional, default: all messages)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_conversation_with_messages",
    description:
      "Get a conversation and all its messages formatted for analysis. This is the most useful tool for understanding a support ticket.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        max_age_hours: {
          type: "number",
          description:
            "Only get messages from the last N hours (optional, default: 48)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "send_message",
    description:
      "Send a message to a conversation. Can send as text or internal note.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        content: {
          type: "string",
          description: "The message content to send",
        },
        type: {
          type: "string",
          enum: ["text", "note"],
          description:
            "Message type: 'text' for customer-visible message, 'note' for internal note (default: text)",
        },
        nickname: {
          type: "string",
          description:
            "The nickname to display for the sender (default: 'Support')",
        },
        avatar: {
          type: "string",
          description:
            "URL of the avatar image to display for the sender",
        },
        mentions: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of operator user_ids to mention. Triggers real push/email notifications for mentioned operators. Use with type 'note' for internal mentions. Get operator IDs from the get_operators tool.",
        },
      },
      required: ["session_id", "content"],
    },
  },
  {
    name: "set_conversation_state",
    description:
      "Change the state of a conversation (pending, unresolved, resolved).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        state: {
          type: "string",
          enum: ["pending", "unresolved", "resolved"],
          description: "The new state for the conversation",
        },
      },
      required: ["session_id", "state"],
    },
  },
  {
    name: "update_conversation_meta",
    description:
      "Update metadata for a conversation (email, nickname, subject, segments, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        email: {
          type: "string",
          description: "Customer email address",
        },
        nickname: {
          type: "string",
          description: "Customer display name",
        },
        subject: {
          type: "string",
          description: "Conversation subject",
        },
        segments: {
          type: "array",
          items: { type: "string" },
          description: "Tags/segments for the conversation",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "add_segments",
    description: "Add tags/segments to a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        segments: {
          type: "array",
          items: { type: "string" },
          description: "Segments to add",
        },
      },
      required: ["session_id", "segments"],
    },
  },
  {
    name: "remove_segments",
    description: "Remove tags/segments from a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        segments: {
          type: "array",
          items: { type: "string" },
          description: "Segments to remove",
        },
      },
      required: ["session_id", "segments"],
    },
  },
  {
    name: "search_conversations",
    description: "Search conversations by text query.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "assign_conversation",
    description: "Assign a conversation to a specific operator.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
        user_id: {
          type: "string",
          description: "The operator user ID to assign to",
        },
      },
      required: ["session_id", "user_id"],
    },
  },
  {
    name: "block_conversation",
    description: "Block a conversation (spam, abuse, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "unblock_conversation",
    description: "Unblock a previously blocked conversation.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "delete_conversation",
    description:
      "Permanently delete a conversation. Use with caution, this cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The conversation session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_operators",
    description: "Get list of operators (support team members) for the website.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_visitors",
    description: "Get list of visitors currently browsing the website.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_knowledge_base",
    description:
      "Search TubeOnAI helpdesk knowledge base articles. Use this to find product documentation, FAQs, and how-to guides when answering customer questions.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query describing what the customer needs help with",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 3)",
        },
      },
      required: ["query"],
    },
  },
];

// Helper function to format conversation summary
function formatConversationSummary(conv: Conversation): Record<string, unknown> {
  return {
    session_id: conv.session_id,
    state: conv.state,
    customer: {
      nickname: conv.meta?.nickname || "Unknown",
      email: conv.meta?.email || null,
    },
    last_message: conv.last_message,
    segments: conv.meta?.segments || [],
    unread: conv.unread?.operator || 0,
    created_at: new Date(conv.created_at).toISOString(),
    updated_at: new Date(conv.updated_at).toISOString(),
  };
}

/**
 * Create a configured MCP Server with all Crisp tools and resource handlers.
 */
export interface ServerConfig {
  kb?: KBSearchConfig;
}

export function createServer(crispClient: CrispClient, config?: ServerConfig): Server {
  const server = new Server(
    {
      name: "crisp-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "list_conversations": {
          const conversations = await crispClient.listConversations({
            pageNumber: (args?.page as number) || 1,
            searchQuery: args?.search as string,
            filterUnresolved: (args?.unresolved_only as boolean) || false,
            filterNotRead: (args?.unread_only as boolean) || false,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  conversations.map(formatConversationSummary),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_unresolved_conversations": {
          const maxPages = (args?.max_pages as number) || 5;
          const conversations = await crispClient.getUnresolvedConversations(maxPages);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  conversations.map(formatConversationSummary),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_conversation": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          const conversation = await crispClient.getConversation(sessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(conversation, null, 2),
              },
            ],
          };
        }

        case "get_messages": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          const maxAgeHours = args?.max_age_hours as number | undefined;
          const messages = await crispClient.getAllMessages(
            sessionId,
            10,
            maxAgeHours
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(messages, null, 2),
              },
            ],
          };
        }

        case "get_conversation_with_messages": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          const maxAgeHours = (args?.max_age_hours as number) || 48;
          const conversation = await crispClient.getConversation(sessionId);
          const messages = await crispClient.getAllMessages(
            sessionId,
            10,
            maxAgeHours
          );
          const formatted = crispClient.formatConversationForAnalysis(
            conversation,
            messages
          );
          return {
            content: [
              {
                type: "text",
                text: formatted,
              },
            ],
          };
        }

        case "send_message": {
          const sessionId = args?.session_id as string;
          const content = args?.content as string;
          if (!sessionId || !content) {
            throw new Error("session_id and content are required");
          }
          const messageType = (args?.type as "text" | "note") || "text";
          const nickname = (args?.nickname as string) || "Support";
          const avatar = (args?.avatar as string) || "https://tubeonai.com/wp-content/uploads/2024/09/tubeonai_logo-100x100.webp";

          const mentions = args?.mentions as string[] | undefined;

          const result = await crispClient.sendMessage(sessionId, content, {
            type: messageType,
            user: { nickname, avatar },
            mentions,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, fingerprint: result.fingerprint },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "set_conversation_state": {
          const sessionId = args?.session_id as string;
          const state = args?.state as "pending" | "unresolved" | "resolved";
          if (!sessionId || !state) {
            throw new Error("session_id and state are required");
          }
          await crispClient.setConversationState(sessionId, state);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, state }, null, 2),
              },
            ],
          };
        }

        case "update_conversation_meta": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          const meta: Record<string, unknown> = {};
          if (args?.email) meta.email = args.email;
          if (args?.nickname) meta.nickname = args.nickname;
          if (args?.subject) meta.subject = args.subject;
          if (args?.segments) meta.segments = args.segments;

          await crispClient.updateConversationMeta(sessionId, meta);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, updated: meta }, null, 2),
              },
            ],
          };
        }

        case "add_segments": {
          const sessionId = args?.session_id as string;
          const segments = args?.segments as string[];
          if (!sessionId || !segments) {
            throw new Error("session_id and segments are required");
          }
          await crispClient.addSegments(sessionId, segments);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, added: segments }, null, 2),
              },
            ],
          };
        }

        case "remove_segments": {
          const sessionId = args?.session_id as string;
          const segments = args?.segments as string[];
          if (!sessionId || !segments) {
            throw new Error("session_id and segments are required");
          }
          await crispClient.removeSegments(sessionId, segments);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, removed: segments }, null, 2),
              },
            ],
          };
        }

        case "search_conversations": {
          const query = args?.query as string;
          if (!query) {
            throw new Error("query is required");
          }
          const conversations = await crispClient.searchConversations(query);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  conversations.map(formatConversationSummary),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "assign_conversation": {
          const sessionId = args?.session_id as string;
          const userId = args?.user_id as string;
          if (!sessionId || !userId) {
            throw new Error("session_id and user_id are required");
          }
          await crispClient.assignConversation(sessionId, userId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, assigned_to: userId },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "block_conversation": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          await crispClient.blockConversation(sessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, blocked: true }, null, 2),
              },
            ],
          };
        }

        case "unblock_conversation": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          await crispClient.unblockConversation(sessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, blocked: false }, null, 2),
              },
            ],
          };
        }

        case "delete_conversation": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            throw new Error("session_id is required");
          }
          await crispClient.deleteConversation(sessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, deleted: true }, null, 2),
              },
            ],
          };
        }

        case "get_operators": {
          const operators = await crispClient.getOperators();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(operators, null, 2),
              },
            ],
          };
        }

        case "get_visitors": {
          const visitors = await crispClient.getVisitors();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(visitors, null, 2),
              },
            ],
          };
        }

        case "search_knowledge_base": {
          const query = args?.query as string;
          if (!query) {
            throw new Error("query is required");
          }
          if (!config?.kb) {
            throw new Error(
              "Knowledge base search is not configured. Set LITELLM_API_KEY and LITELLM_BASE_URL."
            );
          }
          const maxResults = (args?.max_results as number) || 3;
          const kbStatus = await getKBStatus();
          if (!kbStatus.available) {
            throw new Error(
              "Knowledge base not available. Run kb-sync or set KB_BLOB_URL."
            );
          }
          const results = await searchKnowledgeBase(query, config.kb, maxResults);
          const formatted = results.map((r, i) => ({
            rank: i + 1,
            title: r.title,
            category: r.category,
            url: r.url,
            relevance: Math.round(r.score * 100) + "%",
            excerpt: r.text,
          }));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatted, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // Handle resource listing
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "crisp://conversations/unresolved",
          name: "Unresolved Conversations",
          description: "List of all unresolved support conversations",
          mimeType: "application/json",
        },
      ],
    };
  });

  // Handle resource reading
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "crisp://conversations/unresolved") {
      const conversations = await crispClient.getUnresolvedConversations(5);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              conversations.map(formatConversationSummary),
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}
