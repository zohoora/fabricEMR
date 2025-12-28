/**
 * Billing Code Suggester Bot - Unit Tests
 */

import { handler } from '../../src/billing-code-suggester-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama } from '../mocks/ollama';
import {
  testPatient,
  officeVisitEncounter,
  hypertensionCondition,
  diabetesCondition,
  getAllTestConditions,
  getAllTestObservations,
} from '../fixtures/fhir-resources';

describe('Billing Code Suggester Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
      observations: getAllTestObservations(),
    });
    mockMedplum.addResource(officeVisitEncounter);
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require encounterId', async () => {
      const event = { input: { patientId: 'test-patient-1' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('encounterId');
    });

    it('should require patientId', async () => {
      const event = { input: { encounterId: 'encounter-office-1' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('patientId');
    });

    it('should accept valid input', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('CPT Code Suggestions', () => {
    it('should suggest E/M codes for office visit', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.cptCodes).toBeDefined();
      expect(result.cptCodes.length).toBeGreaterThan(0);
    });

    it('should include confidence for each CPT code', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.cptCodes.forEach((code: any) => {
        expect(code.confidence).toBeDefined();
        expect(code.confidence).toBeGreaterThanOrEqual(0);
        expect(code.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should include display name for CPT codes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.cptCodes.forEach((code: any) => {
        expect(code.code).toBeDefined();
        expect(code.display).toBeDefined();
      });
    });

    it('should include rationale for CPT suggestions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.cptCodes.forEach((code: any) => {
        expect(code.rationale).toBeDefined();
      });
    });
  });

  describe('ICD-10 Code Suggestions', () => {
    it('should suggest ICD-10 codes for documented conditions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.icd10Codes).toBeDefined();
      expect(result.icd10Codes.length).toBeGreaterThan(0);
    });

    it('should include ICD-10 for hypertension', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      const htnCode = result.icd10Codes.find((c: any) => c.code.startsWith('I10'));
      expect(htnCode).toBeDefined();
    });

    it('should include ICD-10 for diabetes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      const dmCode = result.icd10Codes.find((c: any) => c.code.startsWith('E11'));
      expect(dmCode).toBeDefined();
    });

    it('should prioritize primary diagnosis', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.icd10Codes.length > 0) {
        expect(result.icd10Codes[0].isPrimary).toBeDefined();
      }
    });
  });

  describe('Code Validation', () => {
    it('should validate suggested codes exist', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          validateCodes: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.codesValidated).toBe(true);
    });

    it('should flag potentially outdated codes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
    });
  });

  describe('Medical Necessity', () => {
    it('should link CPT codes to supporting diagnoses', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.cptCodes.forEach((cpt: any) => {
        expect(cpt.supportingDiagnoses).toBeDefined();
      });
    });

    it('should warn about potential medical necessity issues', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.medicalNecessityWarnings).toBeDefined();
    });
  });

  describe('Modifiers', () => {
    it('should suggest applicable modifiers', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          includeModifiers: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      // May or may not have modifiers depending on encounter
      expect(result.modifiers).toBeDefined();
    });
  });

  describe('Bundled Services', () => {
    it('should identify potential bundling issues', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          checkBundling: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.bundlingAlerts).toBeDefined();
    });
  });

  describe('AI Command Generation', () => {
    it('should generate SuggestBillingCodes command', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          generateCommand: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.command).toBeDefined();
      expect(result.command.command).toBe('SuggestBillingCodes');
    });

    it('should mark command as requiring approval', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          generateCommand: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.command.requiresApproval).toBe(true);
    });
  });

  describe('Historical Analysis', () => {
    it('should compare with previous billing patterns', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          includeHistoricalAnalysis: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.historicalAnalysis).toBeDefined();
    });
  });

  describe('Documentation Gaps', () => {
    it('should identify documentation gaps for billing', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          checkDocumentation: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.documentationGaps).toBeDefined();
    });

    it('should suggest documentation improvements', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          checkDocumentation: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.documentationGaps && result.documentationGaps.length > 0) {
        result.documentationGaps.forEach((gap: any) => {
          expect(gap.suggestion).toBeDefined();
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent encounter', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'non-existent',
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
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });
  });

  describe('Confidence Thresholds', () => {
    it('should only include codes above confidence threshold', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          minConfidence: 0.7,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      [...result.cptCodes, ...result.icd10Codes].forEach((code: any) => {
        expect(code.confidence).toBeGreaterThanOrEqual(0.7);
      });
    });
  });

  describe('Audit Trail', () => {
    it('should create audit event for billing suggestions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBeGreaterThan(0);
    });
  });
});
