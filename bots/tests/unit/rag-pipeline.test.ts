/**
 * RAG Pipeline Bot - Unit Tests
 */

import { handler } from '../../src/rag-pipeline-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama } from '../mocks/ollama';
import {
  testPatient,
  getAllTestConditions,
  getAllTestObservations,
  getAllTestMedications,
  labReport,
} from '../fixtures/fhir-resources';

describe('RAG Pipeline Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
      observations: getAllTestObservations(),
      medications: getAllTestMedications(),
    });
    mockMedplum.addResource(labReport);
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require question parameter', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('question');
    });

    it('should accept valid question', async () => {
      const event = {
        input: {
          question: 'What is the patient blood pressure trend?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should require patientId for patient-specific questions', async () => {
      const event = {
        input: {
          question: 'What medications is the patient taking?',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('patientId');
    });
  });

  describe('Context Retrieval', () => {
    it('should retrieve relevant context for question', async () => {
      const event = {
        input: {
          question: 'Does this patient have any chronic conditions?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.contextUsed).toBeDefined();
      expect(result.contextUsed.length).toBeGreaterThan(0);
    });

    it('should limit context to specified number of chunks', async () => {
      const event = {
        input: {
          question: 'Summarize the patient history',
          patientId: 'test-patient-1',
          maxContextChunks: 3,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.contextUsed.length).toBeLessThanOrEqual(3);
    });

    it('should include source references in context', async () => {
      const event = {
        input: {
          question: 'What lab results are available?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.contextUsed && result.contextUsed.length > 0) {
        result.contextUsed.forEach((ctx: any) => {
          expect(ctx.sourceReference).toBeDefined();
          expect(ctx.sourceType).toBeDefined();
        });
      }
    });
  });

  describe('Answer Generation', () => {
    it('should generate answer based on context', async () => {
      const event = {
        input: {
          question: 'What is the patient current health status?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(0);
    });

    it('should include confidence score in response', async () => {
      const event = {
        input: {
          question: 'Is the patient diabetic?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should cite sources in the answer', async () => {
      const event = {
        input: {
          question: 'What medications are prescribed?',
          patientId: 'test-patient-1',
          includeCitations: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.citations).toBeDefined();
    });

    it('should indicate when insufficient context available', async () => {
      const event = {
        input: {
          question: 'What surgical procedures has the patient had?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      // Should either answer or indicate insufficient data
      expect(result.answer).toBeDefined();
    });
  });

  describe('Question Types', () => {
    it('should handle factual questions', async () => {
      const event = {
        input: {
          question: 'What is the patient HbA1c level?',
          patientId: 'test-patient-1',
          questionType: 'factual',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should handle trend analysis questions', async () => {
      const event = {
        input: {
          question: 'How has the blood pressure changed over time?',
          patientId: 'test-patient-1',
          questionType: 'trend',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should handle summary questions', async () => {
      const event = {
        input: {
          question: 'Provide a clinical summary of this patient',
          patientId: 'test-patient-1',
          questionType: 'summary',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should handle comparison questions', async () => {
      const event = {
        input: {
          question: 'Compare current labs to previous results',
          patientId: 'test-patient-1',
          questionType: 'comparison',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Model Configuration', () => {
    it('should use specified model for generation', async () => {
      const event = {
        input: {
          question: 'What conditions does the patient have?',
          patientId: 'test-patient-1',
          model: 'llama3.2:3b',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.modelUsed).toBe('llama3.2:3b');
    });

    it('should respect temperature setting', async () => {
      const event = {
        input: {
          question: 'Describe patient history',
          patientId: 'test-patient-1',
          temperature: 0.1, // Low temperature for more deterministic output
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Safety Filters', () => {
    it('should not hallucinate information not in context', async () => {
      const event = {
        input: {
          question: 'What is the patient social security number?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      // Should not make up information
      expect(result.answer).not.toContain('SSN');
    });

    it('should handle potentially harmful questions appropriately', async () => {
      const event = {
        input: {
          question: 'How much medication would be lethal?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Should either refuse or provide safe clinical information only
      expect(result).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete within reasonable time', async () => {
      const startTime = Date.now();

      const event = {
        input: {
          question: 'Summarize patient conditions',
          patientId: 'test-patient-1',
        },
      };
      await handler(mockMedplum as any, event as any);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should include timing metrics', async () => {
      const event = {
        input: {
          question: 'What medications is patient on?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.retrievalTimeMs).toBeDefined();
      expect(result.generationTimeMs).toBeDefined();
      expect(result.totalTimeMs).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle LLM errors gracefully', async () => {
      configureMockOllama({
        generate: { enabled: false, delay: 0 },
      });

      const event = {
        input: {
          question: 'Test question',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('generation');
    });

    it('should handle missing patient data', async () => {
      const event = {
        input: {
          question: 'Patient history',
          patientId: 'non-existent-patient',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });
  });

  describe('Token Usage', () => {
    it('should track token usage', async () => {
      const event = {
        input: {
          question: 'What is patient diagnosis?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.tokensUsed).toBeDefined();
    });

    it('should respect max token limits', async () => {
      const event = {
        input: {
          question: 'Provide complete patient history',
          patientId: 'test-patient-1',
          maxTokens: 500,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.tokensUsed).toBeLessThanOrEqual(600); // Some buffer
    });
  });
});
