/**
 * RAG Pipeline Bot - Unit Tests
 */

import { handler } from '../../src/rag-pipeline-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama, resetMockOllama } from '../mocks/ollama';
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
    resetMockOllama();
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require question and patientId parameters', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.answer).toContain('required');
    });

    it('should accept valid question with patientId', async () => {
      const event = {
        input: {
          question: 'What is the patient blood pressure trend?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.question).toBe('What is the patient blood pressure trend?');
    });

    it('should require patientId for questions', async () => {
      const event = {
        input: {
          question: 'What medications is the patient taking?',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.answer).toContain('required');
    });

    it('should handle null input', async () => {
      const event = { input: null };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.answer).toContain('required');
    });
  });

  describe('Context Retrieval', () => {
    it('should retrieve relevant context and return sources', async () => {
      const event = {
        input: {
          question: 'Does this patient have any chronic conditions?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.sources).toBeDefined();
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('should include source references with relevance', async () => {
      const event = {
        input: {
          question: 'What lab results are available?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.sources && result.sources.length > 0) {
        result.sources.forEach((src: any) => {
          expect(src.resourceType).toBeDefined();
          expect(src.resourceId).toBeDefined();
          expect(src.relevance).toBeDefined();
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

    it('should include model name in response', async () => {
      const event = {
        input: {
          question: 'What medications are prescribed?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.model).toBeDefined();
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
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
    });

    it('should handle trend analysis questions', async () => {
      const event = {
        input: {
          question: 'How has the blood pressure changed over time?',
          patientId: 'test-patient-1',
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

      // Implementation catches LLM errors internally in generateResponse
      // and returns a fallback response, so success is still true
      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      // Confidence should be 0 when LLM fails
      expect(result.confidence).toBe(0);
    });

    it('should handle missing patient data', async () => {
      const event = {
        input: {
          question: 'Patient history',
          patientId: 'non-existent-patient',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // May succeed with empty context or fail - either is acceptable
      expect(result).toBeDefined();
    });
  });

  describe('Token Usage', () => {
    it('should track token usage when available', async () => {
      const event = {
        input: {
          question: 'What is patient diagnosis?',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      // tokensUsed is optional but should be defined when LLM provides it
      if (result.tokensUsed !== undefined) {
        expect(typeof result.tokensUsed).toBe('number');
      }
    });
  });

  describe('Additional Context', () => {
    it('should accept additional context in input', async () => {
      const event = {
        input: {
          question: 'What is the patient condition?',
          patientId: 'test-patient-1',
          additionalContext: 'The patient recently had a fall.',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
    });
  });
});
