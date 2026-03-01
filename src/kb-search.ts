/**
 * Knowledge Base Search Module
 *
 * Loads pre-computed embeddings and performs cosine similarity search.
 * Used by the MCP server to answer product questions from the helpdesk KB.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface KBChunk {
  article_id: string;
  title: string;
  category: string;
  url: string;
  text: string;
  embedding: number[];
}

interface KBData {
  model: string;
  synced_at: string;
  article_count: number;
  chunk_count: number;
  dimensions: number;
  chunks: KBChunk[];
}

export interface SearchResult {
  title: string;
  category: string;
  url: string;
  text: string;
  score: number;
}

// Cached KB data
let cachedKB: KBData | null = null;

function getDataPath(): string {
  // Check multiple possible locations (dist/ vs src/, Vercel vs local)
  const candidates = [
    path.join(__dirname, "..", "data", "kb-embeddings.json"),
    path.join(__dirname, "..", "..", "data", "kb-embeddings.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // Default, will fail with clear error
}

function loadKnowledgeBase(): KBData {
  if (cachedKB) return cachedKB;

  const dataPath = getDataPath();
  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `Knowledge base not found at ${dataPath}. Run 'npx tsx src/kb-sync.ts' to generate it.`
    );
  }

  cachedKB = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as KBData;
  return cachedKB;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

async function embedQuery(
  query: string,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<number[]> {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: query }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

export interface KBSearchConfig {
  litellmBaseUrl: string;
  litellmApiKey: string;
}

export async function searchKnowledgeBase(
  query: string,
  config: KBSearchConfig,
  topK = 3
): Promise<SearchResult[]> {
  const kb = loadKnowledgeBase();

  // Embed the query using the same model that was used for the KB
  const queryEmbedding = await embedQuery(
    query,
    config.litellmBaseUrl,
    config.litellmApiKey,
    kb.model
  );

  // Compute similarity for each chunk
  const scored = kb.chunks.map((chunk) => ({
    title: chunk.title,
    category: chunk.category,
    url: chunk.url,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Sort by score descending and take top-K
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by article title (keep highest-scoring chunk per article)
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const item of scored) {
    if (results.length >= topK) break;
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    results.push(item);
  }

  return results;
}

export function getKBStatus(): { available: boolean; synced_at?: string; article_count?: number; chunk_count?: number } {
  try {
    const kb = loadKnowledgeBase();
    return {
      available: true,
      synced_at: kb.synced_at,
      article_count: kb.article_count,
      chunk_count: kb.chunk_count,
    };
  } catch {
    return { available: false };
  }
}
