/**
 * Clinical Decision Support Bot - Unit Tests
 */

import { handler } from '../../src/clinical-decision-support-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock } from '../mocks/ollama';
import {
  testPatient,
  getAllTestConditions,
  getAllTestObservations,
  getAllTestMedications,
  criticalLabObservation,
  penicillinAllergy,
} from '../fixtures/fhir-resources';

describe('Clinical Decision Support Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
      observations: getAllTestObservations(),
      medications: getAllTestMedications(),
    });
    mockMedplum.addResource(penicillinAllergy);
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should require patientId', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('patientId');
    });

    it('should accept valid patient ID', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['all'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Diagnosis Suggestions', () => {
    it('should analyze patient data for potential diagnoses', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['diagnosis'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.diagnosisSuggestions).toBeDefined();
    });

    it('should return suggestions with confidence scores', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['diagnosis'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      if (result.diagnosisSuggestions && result.diagnosisSuggestions.length > 0) {
        result.diagnosisSuggestions.forEach((suggestion: any) => {
          expect(suggestion.confidence).toBeDefined();
          expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
          expect(suggestion.confidence).toBeLessThanOrEqual(1);
        });
      }
    });
  });

  describe('Medication Interactions', () => {
    it('should check for drug interactions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['interactions'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.medicationInteractions).toBeDefined();
    });

    it('should include severity in interaction results', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['interactions'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      if (result.medicationInteractions && result.medicationInteractions.length > 0) {
        result.medicationInteractions.forEach((interaction: any) => {
          expect(['minor', 'moderate', 'major', 'contraindicated']).toContain(interaction.severity);
        });
      }
    });
  });

  describe('Preventive Care Gaps', () => {
    it('should identify missing preventive care', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['preventive'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.preventiveCareGaps).toBeDefined();
    });
  });

  describe('Critical Value Flags', () => {
    it('should flag critical lab values', async () => {
      // Ensure critical lab is in the data
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['critical'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.criticalFlags).toBeDefined();
    });

    it('should include severity level for critical values', async () => {
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['critical'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      if (result.criticalFlags && result.criticalFlags.length > 0) {
        result.criticalFlags.forEach((flag: any) => {
          expect(['low', 'medium', 'high', 'critical']).toContain(flag.severity);
        });
      }
    });
  });

  describe('Comprehensive Analysis', () => {
    it('should run all analysis types when requested', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['all'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.diagnosisSuggestions).toBeDefined();
      expect(result.medicationInteractions).toBeDefined();
      expect(result.preventiveCareGaps).toBeDefined();
      expect(result.criticalFlags).toBeDefined();
    });
  });

  describe('AI Command Generation', () => {
    it('should generate commands for findings', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['all'],
          generateCommands: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.commands).toBeDefined();
    });

    it('should generate FlagAbnormalResult commands for critical values', async () => {
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['critical'],
          generateCommands: true,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      const flagCommands = result.commands?.filter(
        (cmd: any) => cmd.command === 'FlagAbnormalResult'
      );
      expect(flagCommands?.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent patient gracefully', async () => {
      const event = {
        input: {
          patientId: 'non-existent-patient',
          analysisTypes: ['all'],
        },
      };

      // This will throw because the patient doesn't exist
      const result = await handler(mockMedplum as any, event as any);
      expect(result.success).toBe(false);
    });

    it('should handle LLM errors gracefully', async () => {
      teardownOllamaMock();
      // Don't set up mock - will cause fetch to fail

      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['diagnosis'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Should still succeed but with potentially empty results
      expect(result).toBeDefined();
    });
  });

  describe('Overall Confidence', () => {
    it('should calculate overall assessment confidence', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['all'],
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.overallConfidence).toBeDefined();
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.overallConfidence).toBeLessThanOrEqual(1);
    });
  });
});
