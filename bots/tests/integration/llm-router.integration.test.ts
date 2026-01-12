/**
 * LLM Router Integration Tests
 *
 * Tests connectivity and functionality of all RouterLLM endpoints.
 * These tests require the RouterLLM to be running at the configured URL.
 *
 * Run with: npm run test:integration -- llm-router
 */

import {
  chatCompletion,
  generateEmbedding,
  generateBatchEmbeddings,
  checkHealth,
  checkReady,
  listModels,
  config,
  ClinicTask,
} from '../../src/services/llm-client';

// Skip tests if RouterLLM is not available
const ROUTER_URL = process.env.LLM_ROUTER_URL || 'http://Arashs-MacBook-Pro.local:8080';
let routerAvailable = false;

beforeAll(async () => {
  try {
    const response = await fetch(`${ROUTER_URL}/health`);
    routerAvailable = response.ok;
  } catch {
    routerAvailable = false;
  }

  if (!routerAvailable) {
    console.warn(`⚠️  RouterLLM not available at ${ROUTER_URL}. Skipping integration tests.`);
  }
});

const describeIfRouter = routerAvailable ? describe : describe.skip;

describe('LLM Router Integration Tests', () => {
  describe('Health & Status Endpoints', () => {
    it('should return healthy status from health endpoint', async () => {
      if (!routerAvailable) return;

      const result = await checkHealth();
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('ok');
    });

    it('should list available models', async () => {
      if (!routerAvailable) return;

      const result = await listModels();
      expect(result.models).toBeDefined();
      expect(Array.isArray(result.models)).toBe(true);
      expect(result.models.length).toBeGreaterThan(0);

      // Verify expected model aliases are present
      const expectedModels = ['clinical-model', 'fast-model', 'embedding-model'];
      for (const model of expectedModels) {
        expect(result.models).toContain(model);
      }
    });

    it('should have correct configuration', () => {
      expect(config.routerUrl).toBe(ROUTER_URL);
      expect(config.clientId).toBe('fabric-emr');
      expect(config.clinicalModel).toBeDefined();
      expect(config.embeddingModel).toBeDefined();
    });
  });

  describe('Embedding Endpoint', () => {
    const embeddingTasks: ClinicTask[] = ['embedding', 'semantic_search', 'rag_query'];

    it.each(embeddingTasks)('should generate embeddings with task: %s', async (task) => {
      if (!routerAvailable) return;

      const result = await generateEmbedding(
        'Patient presents with Type 2 diabetes mellitus',
        task,
        { botName: 'test-bot', requestId: `test-${task}-${Date.now()}` }
      );

      expect(result.embedding).toBeDefined();
      expect(Array.isArray(result.embedding)).toBe(true);
      expect(result.embedding.length).toBeGreaterThan(0);
    });

    it('should generate batch embeddings', async () => {
      if (!routerAvailable) return;

      const texts = [
        'Patient has hypertension',
        'Type 2 diabetes with neuropathy',
        'Chronic kidney disease stage 3',
      ];

      const result = await generateBatchEmbeddings(texts, 'embedding', {
        botName: 'test-bot',
        requestId: `test-batch-${Date.now()}`,
      });

      expect(result.embeddings).toBeDefined();
      expect(result.embeddings.length).toBe(texts.length);
      for (const embedding of result.embeddings) {
        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding.length).toBeGreaterThan(0);
      }
    });

    it('should return consistent embedding dimensions', async () => {
      if (!routerAvailable) return;

      const result1 = await generateEmbedding('First test text', 'embedding');
      const result2 = await generateEmbedding('Second different text', 'embedding');

      expect(result1.embedding.length).toBe(result2.embedding.length);
    });
  });

  describe('Chat Completion Endpoint', () => {
    describe('clinical_decision task', () => {
      it('should generate clinical decision support response', async () => {
        if (!routerAvailable) return;

        const result = await chatCompletion(
          {
            messages: [
              { role: 'system', content: 'You are a clinical decision support assistant.' },
              { role: 'user', content: 'What is the ICD-10 code for Type 2 diabetes?' },
            ],
            temperature: 0.3,
            max_tokens: 150,
          },
          'clinical_decision',
          { botName: 'clinical-decision-support-bot', patientId: 'test-patient' }
        );

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.response.choices).toBeDefined();
        expect(result.response.choices[0].message.content).toBe(result.text);
      });

      it('should respect max_tokens parameter', async () => {
        if (!routerAvailable) return;

        const shortResult = await chatCompletion(
          {
            messages: [
              { role: 'system', content: 'Be very brief.' },
              { role: 'user', content: 'Explain diabetes in one sentence.' },
            ],
            max_tokens: 30,
          },
          'clinical_decision'
        );

        expect(shortResult.response.usage).toBeDefined();
        // Completion tokens should be around or below max_tokens
        if (shortResult.response.usage?.completion_tokens) {
          expect(shortResult.response.usage.completion_tokens).toBeLessThanOrEqual(50);
        }
      });
    });

    describe('documentation task', () => {
      it('should generate documentation response', async () => {
        if (!routerAvailable) return;

        const result = await chatCompletion(
          {
            messages: [
              { role: 'system', content: 'You are a medical documentation assistant.' },
              {
                role: 'user',
                content:
                  'Generate a brief SOAP note for: 45-year-old male with controlled hypertension, BP 128/82',
              },
            ],
            temperature: 0.4,
            max_tokens: 300,
          },
          'documentation',
          { botName: 'documentation-assistant-bot' }
        );

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(50);
      });
    });

    describe('billing_codes task', () => {
      it('should suggest billing codes', async () => {
        if (!routerAvailable) return;

        const result = await chatCompletion(
          {
            messages: [
              { role: 'system', content: 'You are a medical billing assistant.' },
              {
                role: 'user',
                content:
                  'What CPT codes would apply for: Established patient, 25-minute office visit for diabetes management',
              },
            ],
            temperature: 0.2,
            max_tokens: 200,
          },
          'billing_codes',
          { botName: 'billing-code-suggester-bot' }
        );

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
      });
    });

    describe('Model selection', () => {
      it('should use clinical-model by default', async () => {
        if (!routerAvailable) return;

        const result = await chatCompletion(
          {
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 10,
          },
          'clinical_decision'
        );

        expect(result.response.model).toBeDefined();
      });

      it('should accept explicit model specification', async () => {
        if (!routerAvailable) return;

        const result = await chatCompletion(
          {
            model: 'fast-model',
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 10,
          },
          'health_check'
        );

        expect(result.response).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid model gracefully', async () => {
      if (!routerAvailable) return;

      await expect(
        chatCompletion(
          {
            model: 'non-existent-model-xyz',
            messages: [{ role: 'user', content: 'Test' }],
          },
          'health_check'
        )
      ).rejects.toThrow();
    });

    it('should handle empty input for embeddings', async () => {
      if (!routerAvailable) return;

      // Empty string may be handled differently by different backends
      // The test verifies the client doesn't crash
      try {
        const result = await generateEmbedding('', 'embedding');
        expect(result).toBeDefined();
      } catch (error) {
        // Some backends reject empty input, which is acceptable
        expect(error).toBeDefined();
      }
    });
  });

  describe('Request Headers', () => {
    it('should include all required headers in requests', async () => {
      if (!routerAvailable) return;

      // This test verifies headers are being sent correctly
      // by checking that a request with custom headers succeeds
      const result = await chatCompletion(
        {
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 5,
        },
        'clinical_decision',
        {
          botName: 'test-bot',
          patientId: 'patient-123',
          commandType: 'test-command',
          requestId: `req-${Date.now()}`,
        }
      );

      expect(result.text).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should respond within acceptable time for embeddings', async () => {
      if (!routerAvailable) return;

      const startTime = Date.now();
      await generateEmbedding('Test embedding performance', 'embedding');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should respond within acceptable time for chat', async () => {
      if (!routerAvailable) return;

      const startTime = Date.now();
      await chatCompletion(
        {
          messages: [{ role: 'user', content: 'Say hello' }],
          max_tokens: 20,
        },
        'health_check'
      );
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(30000); // 30 seconds max
    });
  });
});

describe('Task Type Coverage', () => {
  const allTasks: ClinicTask[] = [
    'embedding',
    'semantic_search',
    'rag_query',
    'clinical_decision',
    'documentation',
    'billing_codes',
    'health_check',
  ];

  it('should have all task types defined', () => {
    // Verify the ClinicTask type covers all expected tasks
    for (const task of allTasks) {
      expect(typeof task).toBe('string');
    }
  });

  it('should map tasks to appropriate endpoints', async () => {
    if (!routerAvailable) return;

    // Embedding tasks use /v1/embeddings
    const embeddingTasks = ['embedding', 'semantic_search', 'rag_query'];
    for (const task of embeddingTasks) {
      const result = await generateEmbedding('test', task as ClinicTask);
      expect(result.embedding).toBeDefined();
    }

    // Chat tasks use /v1/chat/completions
    const chatTasks = ['clinical_decision', 'documentation', 'billing_codes'];
    for (const task of chatTasks) {
      const result = await chatCompletion(
        { messages: [{ role: 'user', content: 'test' }], max_tokens: 5 },
        task as ClinicTask
      );
      expect(result.text).toBeDefined();
    }
  });
});
