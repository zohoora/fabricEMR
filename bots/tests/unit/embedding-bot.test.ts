/**
 * Embedding Bot - Unit Tests
 */

import { handler } from '../../src/embedding-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama, resetMockOllama } from '../mocks/ollama';
import { testPatient, labReport, hba1cObservation, hypertensionCondition } from '../fixtures/fhir-resources';

describe('Embedding Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
    });
    resetMockOllama();
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Supported Resource Types', () => {
    it('should process DiagnosticReport resources', async () => {
      const event = { input: labReport };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resourceType).toBe('DiagnosticReport');
      expect(result.embeddingsStored).toBeGreaterThanOrEqual(0);
    });

    it('should process Observation resources', async () => {
      const event = { input: hba1cObservation };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resourceType).toBe('Observation');
    });

    it('should process Condition resources', async () => {
      const event = { input: hypertensionCondition };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.resourceType).toBe('Condition');
    });

    it('should reject unsupported resource types', async () => {
      const unsupportedResource = {
        resourceType: 'Organization',
        id: 'org-1',
        name: 'Test Org',
      };

      const event = { input: unsupportedResource };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
    });
  });

  describe('Text Extraction', () => {
    it('should extract text from DiagnosticReport conclusion', async () => {
      const reportWithConclusion = {
        ...labReport,
        conclusion: 'Critical finding requiring immediate attention.',
      };

      const event = { input: reportWithConclusion };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.chunksProcessed).toBeGreaterThan(0);
    });

    it('should handle resources with minimal text', async () => {
      const minimalCondition = {
        resourceType: 'Condition',
        id: 'condition-minimal',
        subject: { reference: 'Patient/test-patient-1' },
        // No code or text - will get default "Unknown condition"
      };

      const event = { input: minimalCondition };
      const result = await handler(mockMedplum as any, event as any);

      // Should still process with minimal text ("Condition: Unknown condition")
      expect(result.success).toBe(true);
      expect(result.chunksProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Chunking', () => {
    it('should chunk long text appropriately', async () => {
      const longContent = 'A'.repeat(5000); // Longer than typical chunk size
      const documentWithLongText = {
        resourceType: 'DocumentReference',
        id: 'doc-long',
        status: 'current',
        subject: { reference: 'Patient/test-patient-1' },
        content: [
          {
            attachment: {
              contentType: 'text/plain',
              data: Buffer.from(longContent).toString('base64'),
            },
          },
        ],
      };

      const event = { input: documentWithLongText };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.chunksProcessed).toBeGreaterThan(1);
    });
  });

  describe('Embedding Storage', () => {
    it('should store embeddings as Binary resources', async () => {
      const event = { input: hypertensionCondition };
      await handler(mockMedplum as any, event as any);

      const binaries = mockMedplum.getResources('Binary');
      expect(binaries.length).toBeGreaterThan(0);

      const binary = binaries[0] as any;
      expect(binary.contentType).toBe('application/json');

      const data = JSON.parse(Buffer.from(binary.data, 'base64').toString());
      expect(data.type).toBe('clinical_embedding');
      expect(data.embedding).toBeDefined();
      expect(data.embedding.length).toBe(768); // Expected dimension
    });

    it('should include metadata in stored embeddings', async () => {
      const event = { input: hypertensionCondition };
      await handler(mockMedplum as any, event as any);

      const binaries = mockMedplum.getResources('Binary');
      const data = JSON.parse(Buffer.from((binaries[0] as any).data, 'base64').toString());

      expect(data.fhir_resource_type).toBe('Condition');
      expect(data.fhir_resource_id).toBe(hypertensionCondition.id);
      expect(data.patient_id).toBeDefined();
      expect(data.content_type).toBeDefined();
      expect(data.content_text).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle Ollama API errors gracefully', async () => {
      configureMockOllama({
        embeddings: { enabled: false, delay: 0 },
      });

      const event = { input: hypertensionCondition };
      const result = await handler(mockMedplum as any, event as any);

      // When Ollama fails, no embeddings are stored but processing completes
      expect(result.success).toBe(true);
      expect(result.embeddingsStored).toBe(0);
    });

    it('should handle missing patient reference', async () => {
      const conditionWithoutPatient = {
        resourceType: 'Condition',
        id: 'condition-no-patient',
        code: {
          text: 'Test condition',
        },
        // No subject reference
      };

      const event = { input: conditionWithoutPatient };
      const result = await handler(mockMedplum as any, event as any);

      // Should still process but patient_id will be undefined
      expect(result.success).toBe(true);
    });

    it('should handle null input', async () => {
      const event = { input: null };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing resource id', async () => {
      const event = { input: { resourceType: 'Condition' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid resource');
    });
  });

  describe('Performance', () => {
    it('should process embeddings efficiently', async () => {
      const startTime = Date.now();

      const event = { input: labReport };
      await handler(mockMedplum as any, event as any);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
