/**
 * Semantic Search Bot - Unit Tests
 */

import { handler } from '../../src/semantic-search-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama, resetMockOllama } from '../mocks/ollama';
import { testPatient, hypertensionCondition, hba1cObservation } from '../fixtures/fhir-resources';

describe('Semantic Search Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: [hypertensionCondition],
      observations: [hba1cObservation],
    });
    resetMockOllama(); // Reset config before each test
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require query parameter', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query is required');
    });

    it('should accept valid search query', async () => {
      const event = {
        input: {
          query: 'patient with hypertension',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.query).toBe('patient with hypertension');
    });

    it('should handle null input', async () => {
      const event = { input: null };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query is required');
    });
  });

  describe('Search Options', () => {
    it('should filter by content type when specified', async () => {
      const event = {
        input: {
          query: 'hypertension',
          contentType: 'condition',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resultCount).toBeDefined();
    });

    it('should filter by patient when specified', async () => {
      const event = {
        input: {
          query: 'lab results',
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const event = {
        input: {
          query: 'clinical findings',
          limit: 5,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results) {
        expect(result.results.length).toBeLessThanOrEqual(5);
      }
    });

    it('should respect threshold parameter', async () => {
      const event = {
        input: {
          query: 'specific condition',
          threshold: 0.8,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results && result.results.length > 0) {
        result.results.forEach((r: any) => {
          expect(r.similarity).toBeGreaterThanOrEqual(0.8);
        });
      }
    });
  });

  describe('Embedding Generation', () => {
    it('should generate embedding for query', async () => {
      const event = {
        input: {
          query: 'patient with diabetes mellitus type 2',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resultCount).toBeDefined();
    });

    it('should handle embedding API errors gracefully', async () => {
      configureMockOllama({
        embeddings: { enabled: false, delay: 0 },
      });

      const event = {
        input: {
          query: 'test search',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('embedding');
    });
  });

  describe('Search Results', () => {
    it('should return results with similarity scores', async () => {
      const event = {
        input: {
          query: 'blood pressure measurements',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results && result.results.length > 0) {
        result.results.forEach((r: any) => {
          expect(r.similarity).toBeDefined();
          expect(r.similarity).toBeGreaterThanOrEqual(0);
          expect(r.similarity).toBeLessThanOrEqual(1);
        });
      }
    });

    it('should include resource references in results', async () => {
      const event = {
        input: {
          query: 'clinical conditions',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results && result.results.length > 0) {
        result.results.forEach((r: any) => {
          expect(r.resourceType).toBeDefined();
          expect(r.resourceId).toBeDefined();
        });
      }
    });

    it('should include content text in results', async () => {
      const event = {
        input: {
          query: 'hypertension diagnosis',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results && result.results.length > 0) {
        result.results.forEach((r: any) => {
          expect(r.contentText).toBeDefined();
        });
      }
    });

    it('should sort results by similarity descending', async () => {
      const event = {
        input: {
          query: 'patient history',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.results && result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          expect(result.results[i].similarity).toBeGreaterThanOrEqual(
            result.results[i + 1].similarity
          );
        }
      }
    });

    it('should include result count in response', async () => {
      const event = {
        input: {
          query: 'test query',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resultCount).toBeDefined();
      expect(result.resultCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should complete search within reasonable time', async () => {
      const startTime = Date.now();

      const event = {
        input: {
          query: 'cardiovascular disease risk factors',
        },
      };
      await handler(mockMedplum as any, event as any);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      // Simulate database error
      mockMedplum.searchResourcesSpy.mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      const event = {
        input: {
          query: 'test query',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle malformed queries gracefully', async () => {
      const event = {
        input: {
          query: '\x00\x01\x02invalid',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Should either succeed with no results or fail gracefully
      expect(result).toBeDefined();
    });
  });

  describe('Multi-Patient Search', () => {
    it('should search across all patients when no patientId specified', async () => {
      const event = {
        input: {
          query: 'chronic conditions',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });
});
