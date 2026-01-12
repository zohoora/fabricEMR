/**
 * Mock LLM Router API (OpenAI-compatible format)
 *
 * Provides mock implementations for embeddings and chat completion APIs.
 * Supports both old Ollama format (for backward compatibility) and new OpenAI format.
 */

// Store for controlling mock behavior
interface LLMMockConfig {
  embeddings: {
    enabled: boolean;
    delay: number;
    error?: Error;
    embedding?: number[];
  };
  generate: {
    enabled: boolean;
    delay: number;
    error?: Error;
    response?: string;
    evalCount?: number;
  };
}

const defaultConfig: LLMMockConfig = {
  embeddings: {
    enabled: true,
    delay: 0,
  },
  generate: {
    enabled: true,
    delay: 0,
  },
};

let mockConfig = { ...defaultConfig };

/**
 * Generate a random embedding vector
 */
function generateMockEmbedding(dimensions: number = 768): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    embedding.push(Math.random() * 2 - 1);
  }
  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map((v) => v / magnitude);
}

/**
 * Check if prompt matches any of the given patterns
 */
function promptMatches(prompt: string, ...patterns: string[]): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return patterns.some((p) => lowerPrompt.includes(p.toLowerCase()));
}

/**
 * Generate a mock clinical response
 */
function generateMockResponse(prompt: string): string {
  // Detect what type of response is expected
  if (promptMatches(prompt, 'DIAGNOSIS', 'diagnos')) {
    return `Based on the patient's presentation, the following conditions should be considered:

DIAGNOSIS: Essential Hypertension
CODE: I10
CONFIDENCE: 0.85
REASONING: Patient presents with elevated blood pressure readings over multiple visits.
---
DIAGNOSIS: Type 2 Diabetes Mellitus
CODE: E11.9
CONFIDENCE: 0.75
REASONING: HbA1c of 7.2% indicates diabetes management needed.`;
  }

  if (promptMatches(prompt, 'BILLING', 'CPT', 'ICD-10')) {
    return `CODE: 99213
SYSTEM: CPT
DESCRIPTION: Office visit, established patient, low complexity
CONFIDENCE: 0.8
REASONING: Standard follow-up visit with medication review
---
CODE: I10
SYSTEM: ICD-10-CM
DESCRIPTION: Essential (primary) hypertension
CONFIDENCE: 0.9
REASONING: Primary diagnosis for this encounter`;
  }

  if (promptMatches(prompt, 'SOAP', 'PROGRESS NOTE')) {
    return `SUBJECTIVE:
Patient presents for routine follow-up. Reports compliance with medications. [CLINICIAN TO COMPLETE]

OBJECTIVE:
Vital Signs: BP 138/88, HR 72, T 98.6F
General: Alert, oriented, no acute distress
[CLINICIAN TO COMPLETE: Physical exam findings]

ASSESSMENT:
1. Hypertension - controlled on current regimen
2. Type 2 Diabetes - HbA1c at goal

PLAN:
1. Continue current medications
2. Follow up in 3 months
3. Repeat labs prior to next visit`;
  }

  if (promptMatches(prompt, 'REFERRAL')) {
    return `Dear Colleague,

I am referring [PATIENT NAME] for evaluation of [REFERRAL REASON].

CLINICAL SUMMARY:
[CLINICIAN TO COMPLETE]

RELEVANT HISTORY:
- Hypertension, well-controlled
- Type 2 Diabetes

SPECIFIC QUESTIONS:
1. Assessment of current condition
2. Treatment recommendations

Thank you for your consultation.`;
  }

  // Default response
  return `Based on the clinical context provided, the patient's condition appears stable. Key findings include well-controlled hypertension and diabetes management within target parameters. Continued monitoring is recommended. [CLINICIAN TO COMPLETE: Additional clinical judgment needed]`;
}

/**
 * Extract prompt content from OpenAI-format messages
 */
function extractPromptFromMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => m.content).join('\n\n');
}

/**
 * Mock fetch implementation for LLM Router API (OpenAI-compatible)
 */
export function mockLLMFetch(url: string, options?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = options?.body ? JSON.parse(options.body as string) : {};

    // Handle OpenAI-format embeddings endpoint (/v1/embeddings)
    if (url.includes('/v1/embeddings')) {
      if (!mockConfig.embeddings.enabled) {
        resolve(new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), { status: 503 }));
        return;
      }

      if (mockConfig.embeddings.error) {
        reject(mockConfig.embeddings.error);
        return;
      }

      setTimeout(() => {
        const embedding = mockConfig.embeddings.embedding || generateMockEmbedding();
        // OpenAI format response
        resolve(
          new Response(
            JSON.stringify({
              object: 'list',
              data: [
                {
                  object: 'embedding',
                  index: 0,
                  embedding: embedding,
                },
              ],
              model: body.model || 'embedding-model',
              usage: {
                prompt_tokens: 10,
                total_tokens: 10,
              },
            }),
            { status: 200 }
          )
        );
      }, mockConfig.embeddings.delay);
      return;
    }

    // Handle OpenAI-format chat completions endpoint (/v1/chat/completions)
    if (url.includes('/v1/chat/completions')) {
      if (!mockConfig.generate.enabled) {
        resolve(new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), { status: 503 }));
        return;
      }

      if (mockConfig.generate.error) {
        reject(mockConfig.generate.error);
        return;
      }

      setTimeout(() => {
        const prompt = body.messages ? extractPromptFromMessages(body.messages) : body.prompt || '';
        const responseText = mockConfig.generate.response || generateMockResponse(prompt);
        // OpenAI format response
        resolve(
          new Response(
            JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: body.model || 'clinical-model',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: responseText,
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: mockConfig.generate.evalCount || 150,
                total_tokens: 50 + (mockConfig.generate.evalCount || 150),
              },
            }),
            { status: 200 }
          )
        );
      }, mockConfig.generate.delay);
      return;
    }

    // Legacy: Handle Ollama-format embeddings endpoint (/api/embeddings)
    if (url.includes('/api/embeddings')) {
      if (!mockConfig.embeddings.enabled) {
        resolve(new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 }));
        return;
      }

      if (mockConfig.embeddings.error) {
        reject(mockConfig.embeddings.error);
        return;
      }

      setTimeout(() => {
        const embedding = mockConfig.embeddings.embedding || generateMockEmbedding();
        resolve(new Response(JSON.stringify({ embedding }), { status: 200 }));
      }, mockConfig.embeddings.delay);
      return;
    }

    // Legacy: Handle Ollama-format generate endpoint (/api/generate)
    if (url.includes('/api/generate')) {
      if (!mockConfig.generate.enabled) {
        resolve(new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 }));
        return;
      }

      if (mockConfig.generate.error) {
        reject(mockConfig.generate.error);
        return;
      }

      setTimeout(() => {
        const response = mockConfig.generate.response || generateMockResponse(body.prompt || '');
        resolve(
          new Response(
            JSON.stringify({
              response,
              eval_count: mockConfig.generate.evalCount || 150,
            }),
            { status: 200 }
          )
        );
      }, mockConfig.generate.delay);
      return;
    }

    // Handle health endpoint
    if (url.includes('/health')) {
      resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
      return;
    }

    // Handle ready endpoint
    if (url.includes('/ready')) {
      resolve(new Response(JSON.stringify({ ready: true }), { status: 200 }));
      return;
    }

    // Handle models endpoint
    if (url.includes('/v1/models')) {
      resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'clinical-model', object: 'model' },
              { id: 'embedding-model', object: 'model' },
            ],
          }),
          { status: 200 }
        )
      );
      return;
    }

    // Unknown endpoint
    resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
  });
}

// Keep backward compatible function name
export const mockOllamaFetch = mockLLMFetch;

/**
 * Configure mock behavior
 */
export function configureMockOllama(config: Partial<LLMMockConfig>): void {
  mockConfig = {
    ...mockConfig,
    embeddings: { ...mockConfig.embeddings, ...config.embeddings },
    generate: { ...mockConfig.generate, ...config.generate },
  };
}

// Alias for new naming
export const configureMockLLM = configureMockOllama;

/**
 * Reset mock to default configuration
 */
export function resetMockOllama(): void {
  mockConfig = { ...defaultConfig };
}

// Alias for new naming
export const resetMockLLM = resetMockOllama;

/**
 * Setup global fetch mock for LLM Router
 */
export function setupOllamaMock(): void {
  const originalFetch = global.fetch;

  global.fetch = jest.fn((url: string | URL | Request, options?: RequestInit) => {
    const urlString = url.toString();
    // Match LLM Router URLs (localhost:4000, llm-router, ollama, etc.)
    if (
      urlString.includes('ollama') ||
      urlString.includes(':11434') ||
      urlString.includes(':4000') ||
      urlString.includes('llm-router') ||
      urlString.includes('llm-gateway') ||
      urlString.includes('/v1/embeddings') ||
      urlString.includes('/v1/chat/completions') ||
      urlString.includes('/v1/models')
    ) {
      return mockLLMFetch(urlString, options);
    }
    return originalFetch(url, options);
  }) as jest.Mock;
}

// Alias for new naming
export const setupLLMMock = setupOllamaMock;

/**
 * Teardown global fetch mock
 */
export function teardownOllamaMock(): void {
  jest.restoreAllMocks();
}

// Alias for new naming
export const teardownLLMMock = teardownOllamaMock;
