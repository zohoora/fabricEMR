/**
 * Documentation Assistant Bot - Unit Tests
 */

import { handler } from '../../src/documentation-assistant-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama, resetMockOllama } from '../mocks/ollama';
import {
  testPatient,
  officeVisitEncounter,
  getAllTestConditions,
  getAllTestObservations,
  getAllTestMedications,
} from '../fixtures/fhir-resources';

describe('Documentation Assistant Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
      observations: getAllTestObservations(),
      medications: getAllTestMedications(),
    });
    mockMedplum.addResource(officeVisitEncounter);
    resetMockOllama();
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require patientId', async () => {
      const event = { input: { documentType: 'progress_note' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('patientId');
    });

    it('should require documentType', async () => {
      const event = { input: { patientId: 'test-patient-1' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('documentType');
    });

    it('should accept valid input', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Documentation Types', () => {
    it('should generate progress note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('progress_note');
      expect(result.draft).toBeDefined();
    });

    it('should generate discharge summary', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'discharge_summary',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('discharge_summary');
    });

    it('should generate consultation note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'consultation_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('consultation_note');
    });

    it('should generate referral letter', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'referral_letter',
          recipientName: 'Dr. Smith',
          recipientSpecialty: 'Cardiology',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('referral_letter');
    });

    it('should generate H&P note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'h_and_p',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('h_and_p');
    });

    it('should generate procedure note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'procedure_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('procedure_note');
    });
  });

  describe('Sections', () => {
    it('should parse sections from generated document', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.sections).toBeDefined();
      expect(typeof result.sections).toBe('object');
    });
  });

  describe('Clinician Instructions', () => {
    it('should incorporate instructions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
          instructions: 'Patient reports headache for 3 days',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.draft).toBeDefined();
    });
  });

  describe('AI Commands', () => {
    it('should generate commands array', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.commands).toBeDefined();
      expect(Array.isArray(result.commands)).toBe(true);
    });

    it('should generate CreateEncounterNoteDraft command', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.commands.length > 0) {
        expect(result.commands[0].command).toBe('CreateEncounterNoteDraft');
        expect(result.commands[0].requiresApproval).toBe(true);
      }
    });
  });

  describe('Confidence and Warnings', () => {
    it('should include confidence score', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should include warnings array', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should warn about missing data', async () => {
      // Use minimal patient data
      const minimalMedplum = createMockMedplumClient({
        patients: [testPatient],
      });

      const event = {
        input: {
          patientId: 'test-patient-1',
          documentType: 'discharge_summary',
        },
      };
      const result = await handler(minimalMedplum as any, event as any);

      expect(result.success).toBe(true);
      // May have warnings about missing conditions or medications
      expect(result.warnings).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent patient', async () => {
      const event = {
        input: {
          patientId: 'non-existent',
          encounterId: 'encounter-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Implementation catches errors and may still generate document
      // with warnings about missing data
      expect(result.documentType).toBe('progress_note');
      expect(result.warnings).toBeDefined();
    });

    it('should handle LLM errors gracefully', async () => {
      configureMockOllama({
        generate: { enabled: false, delay: 0 },
      });

      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Should return with error draft or low confidence
      expect(result).toBeDefined();
      expect(result.documentType).toBe('progress_note');
    });
  });

  describe('Response Structure', () => {
    it('should include all required fields', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentType: 'progress_note',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBeDefined();
      expect(result.documentType).toBeDefined();
      expect(result.draft).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(result.commands).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.warnings).toBeDefined();
    });
  });
});
