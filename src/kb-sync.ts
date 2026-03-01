#!/usr/bin/env npx tsx
/**
 * Knowledge Base Sync Script
 *
 * Fetches all articles from the Crisp Helpdesk API, strips HTML,
 * chunks by headings, computes embeddings via LiteLLM, and saves
 * to data/kb-embeddings.json.
 *
 * Usage: npx tsx src/kb-sync.ts
 * Env: CRISP_IDENTIFIER, CRISP_KEY, CRISP_WEBSITE_ID, LITELLM_API_KEY, LITELLM_BASE_URL
 */

import { CrispClient } from "./crisp-client.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "kb-embeddings.json");

const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL || "https://litellm.tubeonai.com/v1";
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const EMBEDDING_MODEL = "azure/text-embedding-3-small";
const MAX_CHUNK_CHARS = 1500; // ~375 tokens

interface Article {
  article_id: string;
  title: string;
  status: string;
  url: string;
  content: string;
  category_id?: string;
  created_at: number;
  updated_at: number;
}

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

// --- HTML stripping ---

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<img[^>]*>/gi, "") // Remove images
    .replace(/<[^>]+>/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "") // Remove markdown images
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Chunking ---

function chunkArticle(title: string, html: string): string[] {
  // Split by headings (h2, h3) to get natural sections
  const sections = html.split(/<h[23][^>]*>/i);
  const chunks: string[] = [];

  for (const section of sections) {
    const text = stripHtml(section).trim();
    if (!text || text.length < 20) continue;

    // Prefix with article title for context
    const prefixed = `${title}\n\n${text}`;

    if (prefixed.length <= MAX_CHUNK_CHARS) {
      chunks.push(prefixed);
    } else {
      // Split long sections by paragraphs
      const paragraphs = text.split(/\n\n+/);
      let current = `${title}\n\n`;

      for (const para of paragraphs) {
        if ((current + para).length > MAX_CHUNK_CHARS && current.length > title.length + 5) {
          chunks.push(current.trim());
          current = `${title}\n\n`;
        }
        current += para + "\n\n";
      }
      if (current.trim().length > title.length + 5) {
        chunks.push(current.trim());
      }
    }
  }

  // If no sections found (no headings), treat whole article as one chunk
  if (chunks.length === 0) {
    const text = stripHtml(html).trim();
    if (text.length > 20) {
      const prefixed = `${title}\n\n${text}`;
      if (prefixed.length <= MAX_CHUNK_CHARS) {
        chunks.push(prefixed);
      } else {
        // Split by paragraphs
        const paragraphs = text.split(/\n\n+/);
        let current = `${title}\n\n`;
        for (const para of paragraphs) {
          if ((current + para).length > MAX_CHUNK_CHARS && current.length > title.length + 5) {
            chunks.push(current.trim());
            current = `${title}\n\n`;
          }
          current += para + "\n\n";
        }
        if (current.trim().length > title.length + 5) {
          chunks.push(current.trim());
        }
      }
    }
  }

  return chunks;
}

// --- Embeddings ---

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${LITELLM_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(LITELLM_API_KEY ? { Authorization: `Bearer ${LITELLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// --- Main ---

async function main() {
  // Validate env
  const identifier = process.env.CRISP_IDENTIFIER;
  const key = process.env.CRISP_KEY;
  const websiteId = process.env.CRISP_WEBSITE_ID;

  if (!identifier || !key || !websiteId) {
    console.error("Error: CRISP_IDENTIFIER, CRISP_KEY, CRISP_WEBSITE_ID required");
    process.exit(1);
  }
  if (!LITELLM_API_KEY) {
    console.error("Error: LITELLM_API_KEY required");
    process.exit(1);
  }

  const client = new CrispClient({ identifier, key, websiteId });

  // 1. Fetch all articles (paginated) — list endpoint has category info
  console.log("Fetching articles...");
  interface ArticleListItem {
    article_id: string;
    title: string;
    status: string;
    url: string;
    category?: { category_id: string; name: string };
  }
  const allArticles: ArticleListItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const articles = await client.request<ArticleListItem[]>(
      "GET",
      `/website/${websiteId}/helpdesk/locale/en/articles/${page}`
    );
    if (articles.length === 0) break;
    allArticles.push(...articles);
    console.log(`  Page ${page}: ${articles.length} articles`);
  }
  console.log(`  Total: ${allArticles.length} articles`);

  // Build category map from article list data
  const articleCategoryMap = new Map<string, string>();
  for (const a of allArticles) {
    if (a.category?.name) {
      articleCategoryMap.set(a.article_id, a.category.name);
    }
  }

  // 2. Fetch full content for each published article
  console.log("Fetching article content...");
  const fullArticles: Article[] = [];
  for (const article of allArticles) {
    if (article.status !== "published") continue;
    try {
      const full = await client.request<Article>(
        "GET",
        `/website/${websiteId}/helpdesk/locale/en/article/${article.article_id}`
      );
      fullArticles.push(full);
      process.stdout.write(".");
    } catch (err) {
      console.error(`\n  Failed to fetch ${article.article_id}: ${err}`);
    }
  }
  console.log(`\n  Fetched ${fullArticles.length} articles with content`);

  // 3. Chunk articles
  console.log("Chunking articles...");
  const allChunks: Array<Omit<KBChunk, "embedding">> = [];
  for (const article of fullArticles) {
    const category = articleCategoryMap.get(article.article_id) || "Uncategorized";
    const texts = chunkArticle(article.title, article.content || "");
    for (const text of texts) {
      allChunks.push({
        article_id: article.article_id,
        title: article.title,
        category,
        url: article.url,
        text,
      });
    }
  }
  console.log(`  Created ${allChunks.length} chunks from ${fullArticles.length} articles`);

  // 5. Compute embeddings in batches of 20
  console.log("Computing embeddings...");
  const BATCH_SIZE = 20;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((c) => c.text));
    allEmbeddings.push(...embeddings);
    console.log(`  Embedded ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length}`);
  }

  // 6. Assemble and save
  const kbData: KBData = {
    model: EMBEDDING_MODEL,
    synced_at: new Date().toISOString(),
    article_count: fullArticles.length,
    chunk_count: allChunks.length,
    dimensions: allEmbeddings[0]?.length || 1536,
    chunks: allChunks.map((chunk, i) => ({
      ...chunk,
      embedding: allEmbeddings[i],
    })),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(kbData));

  const fileSizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`\nDone! Saved ${OUTPUT_FILE}`);
  console.log(`  Articles: ${kbData.article_count}`);
  console.log(`  Chunks: ${kbData.chunk_count}`);
  console.log(`  Dimensions: ${kbData.dimensions}`);
  console.log(`  File size: ${fileSizeKB} KB`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
