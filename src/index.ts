#!/usr/bin/env node

/**
 * Crisp MCP Server — stdio transport
 *
 * Uses the shared server factory for local/CLI usage.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CrispClient } from "./crisp-client.js";
import { createServer } from "./server.js";

// Get configuration from environment variables
const CRISP_IDENTIFIER = process.env.CRISP_IDENTIFIER;
const CRISP_KEY = process.env.CRISP_KEY;
const CRISP_WEBSITE_ID = process.env.CRISP_WEBSITE_ID;

if (!CRISP_IDENTIFIER || !CRISP_KEY || !CRISP_WEBSITE_ID) {
  console.error(
    "Error: CRISP_IDENTIFIER, CRISP_KEY, and CRISP_WEBSITE_ID environment variables are required"
  );
  process.exit(1);
}

const crispClient = new CrispClient({
  identifier: CRISP_IDENTIFIER,
  key: CRISP_KEY,
  websiteId: CRISP_WEBSITE_ID,
});

const server = createServer(crispClient);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Crisp MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
