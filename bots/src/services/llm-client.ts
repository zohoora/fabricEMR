/**
 * LLM Client - OpenAI-compatible API client for FabricEMR
 *
 * This module provides a unified interface for interacting with the LLM Router
 * using the OpenAI-compatible API format.
 */

// Helper to safely read environment variables
function getEnv(key: string, fallback = ''): string {
  return (typeof process !== 'undefined' && process.env?.[key]) || fallback;
}

// Configuration from environment variables
// Default to RouterLLM at Arashs-MacBook-Pro.local:8080 as per FabricEMR API Access Guide
const LLM_ROUTER_URL = getEnv('LLM_ROUTER_URL') || getEnv('OLLAMA_API_BASE') || 'http://Arashs-MacBook-Pro.local:8080';
const LLM_API_KEY = getEnv('LLM_API_KEY') || getEnv('LITELLM_API_KEY') || 'fabric-emr-key';
const LLM_CLIENT_ID = getEnv('LLM_CLIENT_ID', 'fabric-emr');
const CLINICAL_MODEL = getEnv('CLINICAL_MODEL') || getEnv('LLM_MODEL') || 'clinical-model';
const FAST_MODEL = getEnv('FAST_MODEL', 'fast-model');
const EMBEDDING_MODEL_NAME = getEnv('EMBEDDING_MODEL', 'embedding-model');

// Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingOptions {
  model?: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface LLMClientHeaders {
  botName?: string;
  patientId?: string;
  commandType?: string;
  requestId?: string;
  clinicTask?: string;
}

export type ClinicTask =
  | 'embedding'
  | 'semantic_search'
  | 'rag_query'
  | 'clinical_decision'
  | 'documentation'
  | 'billing_codes'
  | 'billing_code_suggestion'
  | 'health_check';

/**
 * Build request headers for LLM Router
 */
function buildHeaders(clinicTask: ClinicTask, options?: LLMClientHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': LLM_CLIENT_ID,
    'X-Clinic-Task': clinicTask,
  };

  if (LLM_API_KEY) {
    headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
  }

  if (options?.botName) {
    headers['X-Bot-Name'] = options.botName;
  }

  if (options?.patientId) {
    headers['X-Patient-Id'] = options.patientId;
  }

  if (options?.commandType) {
    headers['X-Command-Type'] = options.commandType;
  }

  if (options?.requestId) {
    headers['X-Request-Id'] = options.requestId;
  }

  return headers;
}

/**
 * Generate chat completion using OpenAI-compatible API
 */
export async function chatCompletion(
  options: ChatCompletionOptions,
  clinicTask: ClinicTask,
  headerOptions?: LLMClientHeaders
): Promise<{ text: string; tokensUsed?: number; response: ChatCompletionResponse }> {
  const url = `${LLM_ROUTER_URL}/v1/chat/completions`;
  const headers = buildHeaders(clinicTask, headerOptions);

  const body = {
    model: options.model || CLINICAL_MODEL,
    messages: options.messages,
    stream: options.stream ?? false,
    temperature: options.temperature ?? 0.3,
    top_p: options.top_p ?? 0.9,
    max_tokens: options.max_tokens ?? 500,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Router error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;

  return {
    text: data.choices[0]?.message?.content || '',
    tokensUsed: data.usage?.completion_tokens,
    response: data,
  };
}

/**
 * Generate embeddings using OpenAI-compatible API
 */
export async function generateEmbedding(
  input: string | string[],
  clinicTask: ClinicTask = 'embedding',
  headerOptions?: LLMClientHeaders
): Promise<{ embedding: number[]; embeddings?: number[][]; tokensUsed?: number }> {
  const url = `${LLM_ROUTER_URL}/v1/embeddings`;
  const headers = buildHeaders(clinicTask, headerOptions);

  const body: EmbeddingOptions = {
    model: EMBEDDING_MODEL_NAME,
    input,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Router embedding error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as EmbeddingResponse;

  // Validate embedding dimensions
  const embedding = data.data[0]?.embedding;
  if (embedding && embedding.length !== 768) {
    console.warn(`Warning: Expected 768-dim embedding, got ${embedding.length}-dim`);
  }

  return {
    embedding: data.data[0]?.embedding || [],
    embeddings: data.data.map((d) => d.embedding),
    tokensUsed: data.usage?.total_tokens,
  };
}

/**
 * Generate batch embeddings (more efficient for multiple texts)
 */
export async function generateBatchEmbeddings(
  texts: string[],
  clinicTask: ClinicTask = 'embedding',
  headerOptions?: LLMClientHeaders
): Promise<{ embeddings: number[][]; tokensUsed?: number }> {
  const result = await generateEmbedding(texts, clinicTask, headerOptions);
  return {
    embeddings: result.embeddings || [result.embedding],
    tokensUsed: result.tokensUsed,
  };
}

/**
 * Health check for LLM Router
 */
export async function checkHealth(): Promise<{ healthy: boolean; status: string }> {
  try {
    const response = await fetch(`${LLM_ROUTER_URL}/health`);
    if (response.ok) {
      const data = (await response.json()) as { status: string };
      return { healthy: data.status === 'ok', status: data.status };
    }
    return { healthy: false, status: `HTTP ${response.status}` };
  } catch (error) {
    return { healthy: false, status: String(error) };
  }
}

/**
 * Check if router is ready
 */
export async function checkReady(): Promise<boolean> {
  try {
    const response = await fetch(`${LLM_ROUTER_URL}/ready`);
    if (response.ok) {
      const data = (await response.json()) as { ready: boolean };
      return data.ready === true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * List available models
 */
export async function listModels(
  headerOptions?: LLMClientHeaders
): Promise<{ models: string[] }> {
  const headers = buildHeaders('health_check', headerOptions);
  const response = await fetch(`${LLM_ROUTER_URL}/v1/models`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to list models: ${response.status}`);
  }

  const data = (await response.json()) as { data: Array<{ id: string }> };
  return { models: data.data.map((m) => m.id) };
}

/**
 * Helper to convert old Ollama-style prompt to chat messages
 */
export function promptToMessages(
  systemPrompt: string,
  userContent: string
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Helper to split a combined prompt into system and user parts
 * Assumes the prompt starts with "You are..." which becomes the system prompt
 */
export function splitPromptToMessages(combinedPrompt: string): ChatMessage[] {
  // Try to find a natural break point between system instruction and user data
  const dataMarkers = [
    '\n\nPATIENT DATA:',
    '\n\nPATIENT INFORMATION:',
    '\n\nENCOUNTER',
    '\n\nCONTEXT:',
    '\n\nQuestion:',
    '\n\nCLINICAL CONTEXT:',
    '\n\n---',
  ];

  for (const marker of dataMarkers) {
    const idx = combinedPrompt.indexOf(marker);
    if (idx !== -1) {
      return [
        { role: 'system', content: combinedPrompt.substring(0, idx).trim() },
        { role: 'user', content: combinedPrompt.substring(idx).trim() },
      ];
    }
  }

  // Fallback: first paragraph is system, rest is user
  const firstNewline = combinedPrompt.indexOf('\n\n');
  if (firstNewline !== -1) {
    return [
      { role: 'system', content: combinedPrompt.substring(0, firstNewline).trim() },
      { role: 'user', content: combinedPrompt.substring(firstNewline).trim() },
    ];
  }

  // Ultimate fallback: everything as user message
  return [{ role: 'user', content: combinedPrompt }];
}

// Export configuration for use in bots
export const config = {
  routerUrl: LLM_ROUTER_URL,
  clinicalModel: CLINICAL_MODEL,
  fastModel: FAST_MODEL,
  embeddingModel: EMBEDDING_MODEL_NAME,
  clientId: LLM_CLIENT_ID,
  apiKey: LLM_API_KEY,
};
