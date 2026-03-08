/**
 * Knowledge Base Search Module
 *
 * Loads pre-computed embeddings from local file (Docker volume at /app/data/)
 * and performs cosine similarity search.
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

// Cached KB data — loaded once, persists for process lifetime
let cachedKB: KBData | null = null;

function loadFromFile(): KBData | null {
  const candidates = [
    process.env.KB_FILE_PATH,
    "/app/data/kb-embeddings.json",
    path.join(__dirname, "..", "data", "kb-embeddings.json"),
    path.join(__dirname, "..", "..", "data", "kb-embeddings.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[kb] Loaded knowledge base from ${p}`);
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KBData;
    }
  }
  return null;
}

function loadKnowledgeBase(): KBData {
  if (cachedKB) return cachedKB;

  const kb = loadFromFile();
  if (!kb) {
    throw new Error(
      "Knowledge base not found. Mount data/kb-embeddings.json or set KB_FILE_PATH."
    );
  }

  cachedKB = kb;
  return kb;
}

/** Call to reload KB from disk (e.g. after a sync). */
export function reloadKnowledgeBase(): void {
  cachedKB = null;
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

  const queryEmbedding = await embedQuery(
    query,
    config.litellmBaseUrl,
    config.litellmApiKey,
    kb.model
  );

  const scored = kb.chunks.map((chunk) => ({
    title: chunk.title,
    category: chunk.category,
    url: chunk.url,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

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

export async function getKBStatus(): Promise<{
  available: boolean;
  synced_at?: string;
  article_count?: number;
  chunk_count?: number;
}> {
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
