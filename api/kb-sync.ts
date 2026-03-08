/**
 * KB Sync — Vercel Cron Job
 *
 * Fetches all Crisp helpdesk articles, strips HTML, chunks,
 * computes embeddings via LiteLLM, and stores in Vercel Blob.
 *
 * Triggered daily via vercel.json cron config.
 * Can also be triggered manually with the correct auth.
 */

import { put } from "@vercel/blob";
import { CrispClient } from "../src/crisp-client.js";

const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL || "https://litellm.tubeonai.com/v1";
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const EMBEDDING_MODEL = "azure/text-embedding-3-small";
const MAX_CHUNK_CHARS = 1500;

export const config = { maxDuration: 300 };

interface KBChunk {
  article_id: string;
  title: string;
  category: string;
  url: string;
  text: string;
  embedding: number[];
}

// --- HTML stripping ---

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
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
  const sections = html.split(/<h[23][^>]*>/i);
  const chunks: string[] = [];

  for (const section of sections) {
    const text = stripHtml(section).trim();
    if (!text || text.length < 20) continue;

    const prefixed = `${title}\n\n${text}`;

    if (prefixed.length <= MAX_CHUNK_CHARS) {
      chunks.push(prefixed);
    } else {
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

  if (chunks.length === 0) {
    const text = stripHtml(html).trim();
    if (text.length > 20) {
      const prefixed = `${title}\n\n${text}`;
      if (prefixed.length <= MAX_CHUNK_CHARS) {
        chunks.push(prefixed);
      } else {
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
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// --- Main handler ---

export async function GET(request: Request): Promise<Response> {
  // Auth: Vercel cron sends Authorization header, or check CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const mcpToken = process.env.MCP_AUTH_TOKEN;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Vercel cron — authorized
  } else if (mcpToken && authHeader === `Bearer ${mcpToken}`) {
    // Manual trigger with MCP token — authorized
  } else {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const identifier = process.env.CRISP_IDENTIFIER;
    const key = process.env.CRISP_KEY;
    const websiteId = process.env.CRISP_WEBSITE_ID;

    if (!identifier || !key || !websiteId) {
      throw new Error("CRISP_IDENTIFIER, CRISP_KEY, CRISP_WEBSITE_ID required");
    }
    if (!LITELLM_API_KEY) {
      throw new Error("LITELLM_API_KEY required");
    }

    const client = new CrispClient({ identifier, key, websiteId });

    // 1. Fetch all articles
    interface ArticleListItem {
      article_id: string;
      title: string;
      status: string;
      url: string;
      category?: { category_id: string; name: string };
    }
    interface ArticleFull {
      article_id: string;
      title: string;
      url: string;
      content: string;
    }

    const allArticles: ArticleListItem[] = [];
    for (let page = 1; page <= 10; page++) {
      const articles = await client.request<ArticleListItem[]>(
        "GET",
        `/website/${websiteId}/helpdesk/locale/en/articles/${page}`
      );
      if (articles.length === 0) break;
      allArticles.push(...articles);
    }

    const articleCategoryMap = new Map<string, string>();
    for (const a of allArticles) {
      if (a.category?.name) {
        articleCategoryMap.set(a.article_id, a.category.name);
      }
    }

    // 2. Fetch content for published articles
    const fullArticles: ArticleFull[] = [];
    for (const article of allArticles) {
      if (article.status !== "published") continue;
      try {
        const full = await client.request<ArticleFull>(
          "GET",
          `/website/${websiteId}/helpdesk/locale/en/article/${article.article_id}`
        );
        fullArticles.push(full);
      } catch {
        // Skip failed articles
      }
    }

    // 3. Chunk
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

    // 4. Embed in batches
    const BATCH_SIZE = 20;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const embeddings = await embedBatch(batch.map((c) => c.text));
      allEmbeddings.push(...embeddings);
    }

    // 5. Save to Vercel Blob
    const kbData = {
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

    const blob = await put("kb-embeddings.json", JSON.stringify(kbData), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        articles: fullArticles.length,
        chunks: allChunks.length,
        dimensions: kbData.dimensions,
        blob_url: blob.url,
        synced_at: kbData.synced_at,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
