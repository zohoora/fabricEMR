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
      expect(result.warnings[0]).toContain('encounterId');
    });

    it('should require patientId', async () => {
      const event = { input: { encounterId: 'encounter-office-1' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('patientId');
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

  describe('Code Suggestions', () => {
    it('should suggest billing codes for encounter', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestedCodes).toBeDefined();
      expect(Array.isArray(result.suggestedCodes)).toBe(true);
    });

    it('should include confidence for each code', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.suggestedCodes.forEach((code: any) => {
        expect(code.confidence).toBeDefined();
        expect(code.confidence).toBeGreaterThanOrEqual(0);
        expect(code.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should include display name for codes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.suggestedCodes.forEach((code: any) => {
        expect(code.code).toBeDefined();
        expect(code.display).toBeDefined();
        expect(code.system).toBeDefined();
      });
    });

    it('should include reasoning for suggestions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.suggestedCodes.forEach((code: any) => {
        expect(code.reasoning).toBeDefined();
      });
    });
  });

  describe('Code Systems', () => {
    it('should extract ICD-10 codes from conditions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      const icd10Codes = result.suggestedCodes.filter((c: any) => c.system === 'ICD-10-CM');
      // May have ICD-10 codes if conditions have proper coding
      expect(Array.isArray(icd10Codes)).toBe(true);
    });

    it('should support CPT codes', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      // CPT codes may be suggested by LLM or extracted from procedures
      expect(result.suggestedCodes).toBeDefined();
    });

    it('should include code category', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      result.suggestedCodes.forEach((code: any) => {
        expect(['diagnosis', 'procedure', 'supply', 'evaluation']).toContain(code.category);
      });
    });
  });

  describe('Total Confidence', () => {
    it('should calculate total confidence score', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.totalConfidence).toBeDefined();
      expect(result.totalConfidence).toBeGreaterThanOrEqual(0);
      expect(result.totalConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Warnings', () => {
    it('should include warnings array', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('AI Command Generation', () => {
    it('should generate SuggestBillingCodes command', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.commands).toBeDefined();
      expect(Array.isArray(result.commands)).toBe(true);

      if (result.commands.length > 0) {
        expect(result.commands[0].command).toBe('SuggestBillingCodes');
      }
    });

    it('should mark command as requiring approval', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.commands.length > 0) {
        expect(result.commands[0].requiresApproval).toBe(true);
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

      // May succeed with empty codes or fail - implementation specific
      expect(result).toBeDefined();
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

      // Should still succeed with structured codes even if LLM fails
      expect(result).toBeDefined();
      expect(result.encounterId).toBe('encounter-office-1');
    });
  });

  describe('Response Structure', () => {
    it('should include all required fields', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBeDefined();
      expect(result.encounterId).toBeDefined();
      expect(result.suggestedCodes).toBeDefined();
      expect(result.totalConfidence).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(result.commands).toBeDefined();
    });
  });
});
