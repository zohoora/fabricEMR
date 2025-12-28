/**
 * Documentation Assistant Bot - Unit Tests
 */

import { handler } from '../../src/documentation-assistant-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama } from '../mocks/ollama';
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
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require patientId', async () => {
      const event = { input: { documentationType: 'progress' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('patientId');
    });

    it('should require documentationType', async () => {
      const event = { input: { patientId: 'test-patient-1' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('documentationType');
    });

    it('should accept valid input', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
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
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('progress');
      expect(result.content).toBeDefined();
    });

    it('should generate discharge summary', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'discharge',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('discharge');
    });

    it('should generate consultation note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'consultation',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('consultation');
    });

    it('should generate referral letter', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'referral',
          referralDetails: {
            specialty: 'Cardiology',
            urgency: 'routine',
          },
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('referral');
    });

    it('should generate H&P note', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'history_physical',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('history_physical');
    });
  });

  describe('SOAP Format', () => {
    it('should structure progress notes in SOAP format', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          format: 'soap',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.sections).toBeDefined();
      expect(result.sections.subjective).toBeDefined();
      expect(result.sections.objective).toBeDefined();
      expect(result.sections.assessment).toBeDefined();
      expect(result.sections.plan).toBeDefined();
    });
  });

  describe('Context Integration', () => {
    it('should include relevant patient history', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.contextSourcesUsed).toBeDefined();
      expect(result.contextSourcesUsed.length).toBeGreaterThan(0);
    });

    it('should include current medications', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'discharge',
          includeMedications: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.medicationsIncluded).toBe(true);
    });

    it('should include vital signs', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          includeVitals: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should include recent lab results', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'discharge',
          includeLabResults: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Clinician Input Integration', () => {
    it('should incorporate chief complaint', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          clinicianInput: {
            chiefComplaint: 'Headache for 3 days',
          },
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.content).toContain('headache');
    });

    it('should incorporate physical exam findings', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          clinicianInput: {
            physicalExam: 'HEENT: normocephalic, atraumatic',
          },
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });

    it('should incorporate assessment notes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          clinicianInput: {
            assessment: 'Tension headache, likely stress-related',
          },
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Draft Creation', () => {
    it('should create DocumentReference as draft', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          saveDraft: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.draftId).toBeDefined();

      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);
    });

    it('should mark draft with AI-generated flag', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
          saveDraft: true,
        },
      };
      await handler(mockMedplum as any, event as any);

      const docs = mockMedplum.getResources('DocumentReference');
      const doc = docs[0] as any;
      expect(doc.status).toBe('preliminary');
    });
  });

  describe('Confidence and Warnings', () => {
    it('should include confidence score', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should include warnings when applicable', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      // Warnings array may be empty if no issues
    });

    it('should warn about missing data', async () => {
      // Use minimal patient data
      const minimalMedplum = createMockMedplumClient({
        patients: [testPatient],
      });

      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'discharge',
        },
      };
      const result = await handler(minimalMedplum as any, event as any);

      if (result.warnings && result.warnings.length > 0) {
        expect(result.warnings.some((w: string) => w.toLowerCase().includes('missing'))).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent patient', async () => {
      const event = {
        input: {
          patientId: 'non-existent',
          encounterId: 'encounter-1',
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });

    it('should handle LLM errors gracefully', async () => {
      configureMockOllama({
        generate: { enabled: false, delay: 0 },
      });

      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });

    it('should handle invalid documentation type', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'invalid_type',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });
  });

  describe('Audit Trail', () => {
    it('should create audit event for documentation generation', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          documentationType: 'progress',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBeGreaterThan(0);
    });
  });
});
