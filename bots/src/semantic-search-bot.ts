/**
 * Semantic Search Bot
 *
 * Performs vector similarity search across clinical embeddings.
 * Can be invoked via custom FHIR operation: POST /Bot/{id}/$execute
 *
 * Input: { query: string, patientId?: string, contentType?: string, limit?: number }
 * Output: Array of similar documents with relevance scores
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import { Binary, Bundle, Resource } from '@medplum/fhirtypes';

// Configuration - uses OLLAMA_API_BASE from docker-compose environment
// Default configuration - vmcontext doesn't have process.env
const OLLAMA_URL = (typeof process !== 'undefined' && process.env?.OLLAMA_API_BASE) ||
                   (typeof process !== 'undefined' && process.env?.OLLAMA_URL) ||
                   'http://host.docker.internal:11434';
const EMBEDDING_MODEL = (typeof process !== 'undefined' && process.env?.EMBEDDING_MODEL) || 'nomic-embed-text';
const DEFAULT_LIMIT = 10;
const SIMILARITY_THRESHOLD = 0.7;

interface SearchInput {
  query: string;
  patientId?: string;
  contentType?: string;
  limit?: number;
  threshold?: number;
}

interface SearchResult {
  resourceType: string;
  resourceId: string;
  contentType: string;
  contentText: string;
  similarity: number;
  patientId?: string;
}

interface EmbeddingData {
  type: string;
  fhir_resource_type: string;
  fhir_resource_id: string;
  content_type: string;
  content_text: string;
  embedding: number[];
  patient_id?: string;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const input = event.input as SearchInput;

  if (!input || !input.query) {
    return {
      success: false,
      error: 'Query is required',
      usage: {
        query: 'string (required)',
        patientId: 'string (optional) - filter by patient',
        contentType: 'string (optional) - filter by content type',
        limit: 'number (optional, default 10)',
        threshold: 'number (optional, default 0.7)',
      },
    };
  }

  const limit = input.limit || DEFAULT_LIMIT;
  const threshold = input.threshold || SIMILARITY_THRESHOLD;

  console.log(`Semantic search: "${input.query.substring(0, 50)}..." (limit: ${limit})`);

  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(input.query);

    if (!queryEmbedding) {
      return { success: false, error: 'Failed to generate query embedding' };
    }

    // Search for similar embeddings
    const results = await searchSimilarEmbeddings(
      medplum,
      queryEmbedding,
      {
        patientId: input.patientId,
        contentType: input.contentType,
        limit,
        threshold,
      }
    );

    console.log(`Found ${results.length} similar documents`);

    return {
      success: true,
      query: input.query,
      resultCount: results.length,
      results: results,
    };
  } catch (error) {
    console.log('Semantic search error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Generate embedding using Ollama
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      console.log('Embedding API error:', response.status);
      return null;
    }

    const result = await response.json() as { embedding: number[] };
    return result.embedding;
  } catch (error) {
    console.log('Error generating embedding:', error);
    return null;
  }
}

/**
 * Search for similar embeddings
 * Note: This implementation uses Binary resources as a workaround.
 * In production, use direct PostgreSQL queries with pgvector.
 */
async function searchSimilarEmbeddings(
  medplum: MedplumClient,
  queryEmbedding: number[],
  options: {
    patientId?: string;
    contentType?: string;
    limit: number;
    threshold: number;
  }
): Promise<SearchResult[]> {
  // Fetch all embedding Binary resources
  // In production, this would be a direct PostgreSQL query using pgvector
  const binaries = await medplum.searchResources('Binary', {
    _count: '1000',
    contenttype: 'application/json',
  });

  const results: SearchResult[] = [];

  for (const binary of binaries) {
    try {
      if (!binary.data) continue;

      const data = JSON.parse(Buffer.from(binary.data, 'base64').toString('utf-8')) as EmbeddingData;

      if (data.type !== 'clinical_embedding') continue;

      // Apply filters
      if (options.patientId && data.patient_id !== options.patientId) continue;
      if (options.contentType && data.content_type !== options.contentType) continue;

      // Calculate cosine similarity
      const similarity = cosineSimilarity(queryEmbedding, data.embedding);

      if (similarity >= options.threshold) {
        results.push({
          resourceType: data.fhir_resource_type,
          resourceId: data.fhir_resource_id,
          contentType: data.content_type,
          contentText: data.content_text,
          similarity: similarity,
          patientId: data.patient_id,
        });
      }
    } catch (error) {
      // Skip invalid binaries
      continue;
    }
  }

  // Sort by similarity (descending) and limit
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, options.limit);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Format search results as a readable string
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No similar documents found.';
  }

  const lines = results.map((r, i) => {
    const truncatedText = r.contentText.length > 200
      ? r.contentText.substring(0, 200) + '...'
      : r.contentText;

    return `${i + 1}. [${r.resourceType}/${r.resourceId}] (similarity: ${(r.similarity * 100).toFixed(1)}%)
   Type: ${r.contentType}
   Text: ${truncatedText}`;
  });

  return lines.join('\n\n');
}

export default handler;
