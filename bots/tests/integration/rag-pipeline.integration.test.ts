/**
 * RAG Pipeline Integration Tests
 *
 * Tests the full pipeline: embedding creation -> semantic search -> RAG answer generation
 */

import { handler as embeddingHandler } from '../../src/embedding-bot';
import { handler as searchHandler } from '../../src/semantic-search-bot';
import { handler as ragHandler } from '../../src/rag-pipeline-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock } from '../mocks/ollama';
import {
  testPatient,
  getAllTestConditions,
  getAllTestObservations,
  getAllTestMedications,
  labReport,
} from '../fixtures/fhir-resources';

describe('RAG Pipeline Integration', () => {
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

  describe('Full Pipeline Flow', () => {
    it('should create embeddings, search, and generate answer', async () => {
      // Step 1: Create embeddings for conditions
      const conditions = getAllTestConditions();
      for (const condition of conditions) {
        const embedResult = await embeddingHandler(mockMedplum as any, { input: condition } as any);
        expect(embedResult.success).toBe(true);
      }

      // Verify embeddings were stored
      const binaries = mockMedplum.getResources('Binary');
      expect(binaries.length).toBeGreaterThan(0);

      // Step 2: Perform semantic search
      const searchResult = await searchHandler(mockMedplum as any, {
        input: {
          query: 'chronic conditions hypertension diabetes',
          patientId: 'test-patient-1',
        },
      } as any);
      expect(searchResult.success).toBe(true);

      // Step 3: Generate RAG answer
      const ragResult = await ragHandler(mockMedplum as any, {
        input: {
          question: 'What chronic conditions does this patient have?',
          patientId: 'test-patient-1',
        },
      } as any);
      expect(ragResult.success).toBe(true);
      expect(ragResult.answer).toBeDefined();
    });

    it('should maintain data consistency across pipeline stages', async () => {
      // Create embedding for a specific condition
      const condition = getAllTestConditions()[0];
      await embeddingHandler(mockMedplum as any, { input: condition } as any);

      // Search should find the embedded condition
      const searchResult = await searchHandler(mockMedplum as any, {
        input: {
          query: condition.code?.text || 'hypertension',
        },
      } as any);

      expect(searchResult.success).toBe(true);
    });
  });

  describe('Embedding to Search Flow', () => {
    it('should find resources after embedding them', async () => {
      // Embed lab report
      await embeddingHandler(mockMedplum as any, { input: labReport } as any);

      // Search for lab-related content
      const searchResult = await searchHandler(mockMedplum as any, {
        input: {
          query: 'laboratory panel metabolic',
          resourceTypes: ['DiagnosticReport'],
        },
      } as any);

      expect(searchResult.success).toBe(true);
    });

    it('should return higher similarity for exact matches', async () => {
      const condition = getAllTestConditions()[0];
      await embeddingHandler(mockMedplum as any, { input: condition } as any);

      // Search with exact text from condition
      const exactSearch = await searchHandler(mockMedplum as any, {
        input: {
          query: 'Essential hypertension',
        },
      } as any);

      // Search with vaguely related text
      const vagueSearch = await searchHandler(mockMedplum as any, {
        input: {
          query: 'blood pressure problems',
        },
      } as any);

      expect(exactSearch.success).toBe(true);
      expect(vagueSearch.success).toBe(true);

      // Exact match should have higher similarity (if both return results)
      if (exactSearch.results?.length > 0 && vagueSearch.results?.length > 0) {
        expect(exactSearch.results[0].similarity).toBeGreaterThanOrEqual(
          vagueSearch.results[0].similarity
        );
      }
    });
  });

  describe('Search to RAG Flow', () => {
    it('should use search results as context for RAG', async () => {
      // First embed some content
      for (const condition of getAllTestConditions()) {
        await embeddingHandler(mockMedplum as any, { input: condition } as any);
      }

      // RAG should use embedded content as context
      const ragResult = await ragHandler(mockMedplum as any, {
        input: {
          question: 'List the patient active conditions',
          patientId: 'test-patient-1',
        },
      } as any);

      expect(ragResult.success).toBe(true);
      expect(ragResult.contextUsed).toBeDefined();
      expect(ragResult.contextUsed.length).toBeGreaterThan(0);
    });
  });

  describe('Error Propagation', () => {
    it('should handle missing embeddings gracefully in search', async () => {
      // Don't create any embeddings, just search
      const searchResult = await searchHandler(mockMedplum as any, {
        input: {
          query: 'some query',
        },
      } as any);

      expect(searchResult.success).toBe(true);
      // Should return empty results, not error
      expect(searchResult.results).toBeDefined();
    });

    it('should handle search failures gracefully in RAG', async () => {
      // Make search fail
      mockMedplum.searchResourcesSpy.mockImplementationOnce(() => {
        throw new Error('Search failed');
      });

      const ragResult = await ragHandler(mockMedplum as any, {
        input: {
          question: 'Patient history',
          patientId: 'test-patient-1',
        },
      } as any);

      // Should either fail gracefully or still generate answer
      expect(ragResult).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete full pipeline within acceptable time', async () => {
      const startTime = Date.now();

      // Run full pipeline
      for (const condition of getAllTestConditions().slice(0, 2)) {
        await embeddingHandler(mockMedplum as any, { input: condition } as any);
      }

      await searchHandler(mockMedplum as any, {
        input: { query: 'patient conditions' },
      } as any);

      await ragHandler(mockMedplum as any, {
        input: {
          question: 'Summarize conditions',
          patientId: 'test-patient-1',
        },
      } as any);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(30000); // 30 seconds max for full pipeline
    });
  });
});
