/**
 * Crisp API Client for MCP Server
 */

export interface CrispConfig {
  identifier: string;
  key: string;
  websiteId: string;
}

export interface Conversation {
  session_id: string;
  website_id: string;
  status: number;
  state: string;
  is_blocked: boolean;
  is_verified: boolean;
  availability: string;
  active: Record<string, unknown>;
  last_message?: string;
  created_at: number;
  updated_at: number;
  unread?: {
    operator: number;
    visitor: number;
  };
  assigned?: {
    user_id: string;
  };
  meta?: {
    nickname?: string;
    email?: string;
    phone?: string;
    address?: string;
    subject?: string;
    ip?: string;
    segments?: string[];
    data?: Record<string, unknown>;
    device?: {
      capabilities?: string[];
      geolocation?: {
        country?: string;
        region?: string;
        city?: string;
      };
      system?: {
        os?: {
          name?: string;
          version?: string;
        };
        engine?: {
          name?: string;
          version?: string;
        };
        browser?: {
          name?: string;
          version?: string;
        };
        useragent?: string;
      };
      timezone?: number;
      locales?: string[];
    };
  };
}

export interface Message {
  session_id: string;
  website_id: string;
  type: string;
  from: string;
  origin: string;
  content: string | { text?: string; url?: string; type?: string };
  stamped: boolean;
  timestamp: number;
  fingerprint: number;
  user?: {
    user_id?: string;
    nickname?: string;
    avatar?: string;
  };
  original?: string;
  edited?: boolean;
  translated?: boolean;
  read?: string;
  delivered?: string;
  references?: string[];
  mentions?: string[];
  preview?: unknown[];
}

export interface ListConversationsOptions {
  pageNumber?: number;
  searchQuery?: string;
  filterUnresolved?: boolean;
  filterNotRead?: boolean;
  orderDateCreated?: boolean;
}

export interface SendMessageOptions {
  type?: "text" | "note";
  from?: "operator" | "user";
  origin?: string;
  user?: {
    nickname?: string;
    avatar?: string;
  };
  stealth?: boolean;
  mentioned?: Array<{ user_id: string }>;
}

export class CrispClient {
  private identifier: string;
  private key: string;
  private websiteId: string;
  private baseUrl = "https://api.crisp.chat/v1";

  constructor(config: CrispConfig) {
    this.identifier = config.identifier;
    this.key = config.key;
    this.websiteId = config.websiteId;
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(
      `${this.identifier}:${this.key}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
        "X-Crisp-Tier": "plugin",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Crisp API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const json = await response.json();
    return json.data as T;
  }

  /**
   * List conversations with optional filtering
   */
  async listConversations(
    options: ListConversationsOptions = {}
  ): Promise<Conversation[]> {
    const {
      pageNumber = 1,
      searchQuery,
      filterUnresolved = false,
      filterNotRead = false,
      orderDateCreated = false,
    } = options;

    let path = `/website/${this.websiteId}/conversations/${pageNumber}`;
    const params = new URLSearchParams();

    if (searchQuery) {
      params.append("search_query", searchQuery);
    }
    if (filterUnresolved) {
      params.append("filter_unresolved", "1");
    }
    if (filterNotRead) {
      params.append("filter_not_read", "1");
    }
    if (orderDateCreated) {
      params.append("order_date_created", "1");
    }

    const queryString = params.toString();
    if (queryString) {
      path += `?${queryString}`;
    }

    return this.request<Conversation[]>("GET", path);
  }

  /**
   * Get unresolved conversations with pagination
   */
  async getUnresolvedConversations(maxPages = 5): Promise<Conversation[]> {
    const allConversations: Conversation[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const conversations = await this.listConversations({
        pageNumber: page,
        filterUnresolved: true,
      });

      if (conversations.length === 0) {
        break;
      }

      allConversations.push(...conversations);
    }

    return allConversations;
  }

  /**
   * Get a single conversation by session ID
   */
  async getConversation(sessionId: string): Promise<Conversation> {
    return this.request<Conversation>(
      "GET",
      `/website/${this.websiteId}/conversation/${sessionId}`
    );
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    sessionId: string,
    timestampBefore?: number
  ): Promise<Message[]> {
    let path = `/website/${this.websiteId}/conversation/${sessionId}/messages`;
    if (timestampBefore) {
      path += `?timestamp_before=${timestampBefore}`;
    }
    return this.request<Message[]>("GET", path);
  }

  /**
   * Get all messages with pagination
   */
  async getAllMessages(
    sessionId: string,
    maxBatches = 10,
    maxAgeHours?: number
  ): Promise<Message[]> {
    const allMessages: Message[] = [];
    let oldestTimestamp: number | undefined;
    const cutoffTime = maxAgeHours
      ? Date.now() - maxAgeHours * 60 * 60 * 1000
      : undefined;

    for (let batch = 0; batch < maxBatches; batch++) {
      const messages = await this.getMessages(sessionId, oldestTimestamp);

      if (messages.length === 0) {
        break;
      }

      // Filter by age if specified
      const filteredMessages = cutoffTime
        ? messages.filter((msg) => msg.timestamp >= cutoffTime)
        : messages;

      allMessages.push(...filteredMessages);

      // If we filtered some messages, we've reached the cutoff
      if (filteredMessages.length < messages.length) {
        break;
      }

      oldestTimestamp = Math.min(...messages.map((m) => m.timestamp));
    }

    // Sort oldest first
    return allMessages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(
    sessionId: string,
    content: string,
    options: SendMessageOptions = {}
  ): Promise<{ fingerprint: number }> {
    const {
      type = "text",
      from = "operator",
      origin = "chat",
      user,
      stealth = false,
      mentioned,
    } = options;

    const payload: Record<string, unknown> = {
      type,
      from,
      origin,
      content,
      stealth,
    };

    if (user) {
      payload.user = user;
    }
    if (mentioned && mentioned.length > 0) {
      payload.mentioned = mentioned;
    }

    return this.request<{ fingerprint: number }>(
      "POST",
      `/website/${this.websiteId}/conversation/${sessionId}/message`,
      payload
    );
  }

  /**
   * Set conversation state (pending, unresolved, resolved)
   */
  async setConversationState(
    sessionId: string,
    state: "pending" | "unresolved" | "resolved"
  ): Promise<void> {
    await this.request<unknown>(
      "PATCH",
      `/website/${this.websiteId}/conversation/${sessionId}/state`,
      { state }
    );
  }

  /**
   * Update conversation metadata
   */
  async updateConversationMeta(
    sessionId: string,
    meta: {
      nickname?: string;
      email?: string;
      phone?: string;
      address?: string;
      subject?: string;
      segments?: string[];
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.request<unknown>(
      "PATCH",
      `/website/${this.websiteId}/conversation/${sessionId}/meta`,
      meta
    );
  }

  /**
   * Add segments to a conversation
   */
  async addSegments(sessionId: string, segments: string[]): Promise<void> {
    const conversation = await this.getConversation(sessionId);
    const existingSegments = conversation.meta?.segments || [];
    const newSegments = [...new Set([...existingSegments, ...segments])];
    await this.updateConversationMeta(sessionId, { segments: newSegments });
  }

  /**
   * Remove segments from a conversation
   */
  async removeSegments(sessionId: string, segments: string[]): Promise<void> {
    const conversation = await this.getConversation(sessionId);
    const existingSegments = conversation.meta?.segments || [];
    const newSegments = existingSegments.filter((s) => !segments.includes(s));
    await this.updateConversationMeta(sessionId, { segments: newSegments });
  }

  /**
   * Get email from conversation
   */
  getEmailFromConversation(conversation: Conversation): string | undefined {
    return conversation.meta?.email;
  }

  /**
   * Format conversation for analysis
   */
  formatConversationForAnalysis(
    conversation: Conversation,
    messages: Message[]
  ): string {
    const lines: string[] = [];

    lines.push("=== CONVERSATION INFO ===");
    lines.push(`Session ID: ${conversation.session_id}`);
    lines.push(`State: ${conversation.state}`);
    lines.push(`Customer: ${conversation.meta?.nickname || "Unknown"}`);
    lines.push(`Email: ${conversation.meta?.email || "Not provided"}`);

    if (conversation.meta?.segments?.length) {
      lines.push(`Segments: ${conversation.meta.segments.join(", ")}`);
    }

    lines.push("");
    lines.push("=== MESSAGES ===");

    for (const msg of messages) {
      const timestamp = new Date(msg.timestamp).toISOString();
      const from =
        msg.from === "user"
          ? `[Customer${msg.user?.nickname ? ` - ${msg.user.nickname}` : ""}]`
          : `[${msg.user?.nickname || "Operator"}]`;

      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content?.text || JSON.stringify(msg.content);

      lines.push(`${timestamp} ${from}: ${content}`);
    }

    return lines.join("\n");
  }

  /**
   * Check if a message is from an operator
   */
  isFromOperator(message: Message): boolean {
    return message.from === "operator";
  }

  /**
   * Search conversations
   */
  async searchConversations(query: string): Promise<Conversation[]> {
    return this.listConversations({ searchQuery: query });
  }

  /**
   * Get conversation routing info
   */
  async getConversationRouting(sessionId: string): Promise<unknown> {
    return this.request<unknown>(
      "GET",
      `/website/${this.websiteId}/conversation/${sessionId}/routing`
    );
  }

  /**
   * Assign conversation to a user
   */
  async assignConversation(
    sessionId: string,
    userId: string
  ): Promise<void> {
    await this.request<unknown>(
      "PATCH",
      `/website/${this.websiteId}/conversation/${sessionId}/routing`,
      { assigned: { user_id: userId } }
    );
  }

  /**
   * Block a conversation
   */
  async blockConversation(sessionId: string): Promise<void> {
    await this.request<unknown>(
      "PATCH",
      `/website/${this.websiteId}/conversation/${sessionId}/block`,
      { blocked: true }
    );
  }

  /**
   * Unblock a conversation
   */
  async unblockConversation(sessionId: string): Promise<void> {
    await this.request<unknown>(
      "PATCH",
      `/website/${this.websiteId}/conversation/${sessionId}/block`,
      { blocked: false }
    );
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(sessionId: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/website/${this.websiteId}/conversation/${sessionId}`
    );
  }

  /**
   * Get website operators
   */
  async getOperators(): Promise<unknown[]> {
    return this.request<unknown[]>(
      "GET",
      `/website/${this.websiteId}/operators/list`
    );
  }

  /**
   * Get website visitors (currently browsing)
   */
  async getVisitors(): Promise<unknown[]> {
    return this.request<unknown[]>(
      "GET",
      `/website/${this.websiteId}/visitors/list`
    );
  }
}
