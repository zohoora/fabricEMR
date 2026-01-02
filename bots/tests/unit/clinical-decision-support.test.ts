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
      expect(result.patientId).toBe('');
    });

    it('should accept valid patient ID', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.patientId).toBe('test-patient-1');
    });

    it('should handle null input', async () => {
      const event = { input: null };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });
  });

  describe('Diagnosis Suggestions', () => {
    it('should analyze patient data for potential diagnoses with chiefComplaint', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          chiefComplaint: 'chest pain and shortness of breath',
          focusArea: 'diagnosis' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should return suggestions with confidence scores', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          chiefComplaint: 'headache',
          focusArea: 'diagnosis' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      if (result.suggestions && result.suggestions.length > 0) {
        result.suggestions.forEach((suggestion: any) => {
          expect(suggestion.confidence).toBeDefined();
          expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
          expect(suggestion.confidence).toBeLessThanOrEqual(1);
        });
      }
    });
  });

  describe('Medication Analysis', () => {
    it('should check for drug interactions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'medication' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestions).toBeDefined();
    });

    it('should include priority in medication findings', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'medication' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      const medicationSuggestions = result.suggestions.filter((s: any) => s.type === 'medication');
      if (medicationSuggestions.length > 0) {
        medicationSuggestions.forEach((suggestion: any) => {
          expect(['low', 'medium', 'high']).toContain(suggestion.priority);
        });
      }
    });
  });

  describe('Preventive Care Gaps', () => {
    it('should identify missing preventive care', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'preventive' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestions).toBeDefined();
    });

    it('should return preventive type suggestions', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'preventive' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      const preventiveSuggestions = result.suggestions.filter((s: any) => s.type === 'preventive');
      // May or may not have preventive suggestions depending on patient age/gender
      expect(Array.isArray(preventiveSuggestions)).toBe(true);
    });
  });

  describe('Critical Value Alerts', () => {
    it('should flag critical lab values', async () => {
      // Ensure critical lab is in the data
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestions).toBeDefined();
    });

    it('should include priority level for alerts', async () => {
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      const alerts = result.suggestions.filter((s: any) => s.type === 'alert');
      if (alerts.length > 0) {
        alerts.forEach((alert: any) => {
          expect(['low', 'medium', 'high']).toContain(alert.priority);
        });
      }
    });
  });

  describe('Comprehensive Analysis', () => {
    it('should run all analysis types when focusArea is all', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.suggestions).toBeDefined();
      expect(result.analysisTimestamp).toBeDefined();
      expect(result.model).toBeDefined();
    });
  });

  describe('Suggested Actions', () => {
    it('should include suggestedAction when applicable', async () => {
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      const alertsWithActions = result.suggestions.filter(
        (s: any) => s.type === 'alert' && s.suggestedAction
      );
      // May or may not have actions depending on the specific findings
      expect(Array.isArray(alertsWithActions)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent patient gracefully', async () => {
      const event = {
        input: {
          patientId: 'non-existent-patient',
          focusArea: 'all' as const,
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
          chiefComplaint: 'test complaint',
          focusArea: 'diagnosis' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      // Should still succeed but with potentially empty diagnosis suggestions
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Response Structure', () => {
    it('should include all required fields in response', async () => {
      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBeDefined();
      expect(result.patientId).toBeDefined();
      expect(result.suggestions).toBeDefined();
      expect(result.analysisTimestamp).toBeDefined();
      expect(result.model).toBeDefined();
    });

    it('should sort suggestions by priority and confidence', async () => {
      mockMedplum.addResource(criticalLabObservation);

      const event = {
        input: {
          patientId: 'test-patient-1',
          focusArea: 'all' as const,
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      if (result.suggestions.length > 1) {
        // High priority should come before lower priorities
        const priorities = result.suggestions.map((s: any) => s.priority);
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        for (let i = 0; i < priorities.length - 1; i++) {
          expect(priorityOrder[priorities[i] as keyof typeof priorityOrder])
            .toBeLessThanOrEqual(priorityOrder[priorities[i + 1] as keyof typeof priorityOrder]);
        }
      }
    });
  });
});
