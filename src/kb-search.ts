/**
 * Knowledge Base Search Module
 *
 * Loads pre-computed embeddings from Vercel Blob (or local fallback)
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

// Cached KB data
let cachedKB: KBData | null = null;
let cacheTimestamp = 0;

// In Docker/Coolify: cache indefinitely (file is baked into image).
// On Vercel: 10min TTL since Blob storage may be updated externally.
const IS_DOCKER = !!process.env.DOCKER || !process.env.VERCEL;
const CACHE_TTL_MS = IS_DOCKER ? Infinity : 10 * 60 * 1000;

async function loadFromBlob(): Promise<KBData | null> {
  const blobUrl = process.env.KB_BLOB_URL;
  if (!blobUrl) return null;

  try {
    const response = await fetch(blobUrl);
    if (!response.ok) return null;
    return (await response.json()) as KBData;
  } catch {
    return null;
  }
}

function loadFromFile(): KBData | null {
  // Check KB_FILE_PATH env first (Docker volume mount), then standard locations
  const envPath = process.env.KB_FILE_PATH;
  const candidates = [
    ...(envPath ? [envPath] : []),
    path.join(__dirname, "..", "data", "kb-embeddings.json"),
    path.join(__dirname, "..", "..", "data", "kb-embeddings.json"),
    "/app/data/kb-embeddings.json", // Docker default
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[kb] Loading knowledge base from ${p}`);
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KBData;
    }
  }
  return null;
}

async function loadKnowledgeBase(): Promise<KBData> {
  const now = Date.now();
  if (cachedKB && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedKB;
  }

  // In Docker: local file first (baked in), Blob as fallback.
  // On Vercel: Blob first (managed), local file as fallback.
  const kb = IS_DOCKER
    ? loadFromFile() || (await loadFromBlob())
    : (await loadFromBlob()) || loadFromFile();

  if (!kb) {
    throw new Error(
      "Knowledge base not found. Mount data/kb-embeddings.json or set KB_BLOB_URL."
    );
  }

  cachedKB = kb;
  cacheTimestamp = now;
  return kb;
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
  const kb = await loadKnowledgeBase();

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
    const kb = await loadKnowledgeBase();
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
