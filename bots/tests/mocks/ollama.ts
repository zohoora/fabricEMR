/**
 * Mock Ollama API
 *
 * Provides mock implementations for Ollama embedding and generation APIs.
 */

// Store for controlling mock behavior
interface OllamaMockConfig {
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

const defaultConfig: OllamaMockConfig = {
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
 * Generate a mock clinical response
 */
function generateMockResponse(prompt: string): string {
  // Detect what type of response is expected
  if (prompt.includes('DIAGNOSIS') || prompt.includes('diagnos')) {
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

  if (prompt.includes('BILLING') || prompt.includes('CPT') || prompt.includes('ICD-10')) {
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

  if (prompt.includes('SOAP') || prompt.includes('PROGRESS NOTE')) {
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

  if (prompt.includes('REFERRAL')) {
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
 * Mock fetch implementation for Ollama API
 */
export function mockOllamaFetch(url: string, options?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = options?.body ? JSON.parse(options.body as string) : {};

    // Handle embeddings endpoint
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

    // Handle generate endpoint
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

    // Unknown endpoint
    resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
  });
}

/**
 * Configure mock behavior
 */
export function configureMockOllama(config: Partial<OllamaMockConfig>): void {
  mockConfig = {
    ...mockConfig,
    embeddings: { ...mockConfig.embeddings, ...config.embeddings },
    generate: { ...mockConfig.generate, ...config.generate },
  };
}

/**
 * Reset mock to default configuration
 */
export function resetMockOllama(): void {
  mockConfig = { ...defaultConfig };
}

/**
 * Setup global fetch mock for Ollama
 */
export function setupOllamaMock(): void {
  const originalFetch = global.fetch;

  global.fetch = jest.fn((url: string | URL | Request, options?: RequestInit) => {
    const urlString = url.toString();
    if (urlString.includes('ollama') || urlString.includes(':11434')) {
      return mockOllamaFetch(urlString, options);
    }
    return originalFetch(url, options);
  }) as jest.Mock;
}

/**
 * Teardown global fetch mock
 */
export function teardownOllamaMock(): void {
  jest.restoreAllMocks();
}
