/**
 * Command Processor Bot - Unit Tests
 */

import { handler } from '../../src/command-processor-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock, configureMockOllama } from '../mocks/ollama';
import { testPatient, getAllTestConditions } from '../fixtures/fhir-resources';
import { AICommand, FlagAbnormalResult, SummarizePatientHistory } from '../../src/types/ai-command-types';

describe('Command Processor Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
    });
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('Input Validation', () => {
    it('should reject missing command', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.action).toBe('blocked');
      expect(result.message).toContain('Invalid command');
    });

    it('should reject null input', async () => {
      const event = { input: null };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.action).toBe('blocked');
    });
  });

  describe('Safety Filters', () => {
    it('should block commands with very low confidence', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Critical value',
        confidence: 0.2, // Below 0.5 threshold
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.action).toBe('blocked');
      expect(result.blockReason).toContain('confidence');
    });

    it('should allow commands with sufficient confidence', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Critical potassium value',
        confidence: 0.85,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('executed');
    });

    it('should include warnings for moderate confidence', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'medium',
        interpretation: 'Elevated value',
        confidence: 0.55, // Between 0.5 and 0.6
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });
  });

  describe('Approval Routing', () => {
    it('should queue commands that require approval', async () => {
      const command = {
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-1',
        noteType: 'progress',
        content: 'Test note content',
        confidence: 0.9,
        requiresApproval: true,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.action).toBe('queued');
      expect(result.taskId).toBeDefined();
    });

    it('should execute auto-approved commands directly', async () => {
      const command: SummarizePatientHistory = {
        command: 'SummarizePatientHistory',
        patientId: 'test-patient-1',
        summaryType: 'comprehensive',
        summary: 'Patient has well-controlled hypertension and diabetes.',
        keyFindings: ['HTN controlled', 'DM at goal'],
        confidence: 0.9,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('executed');
    });
  });

  describe('Command Execution', () => {
    it('should create Flag resource for FlagAbnormalResult', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'critical',
        interpretation: 'Critical potassium: 6.2 mmol/L',
        confidence: 0.95,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(mockMedplum.createResourceSpy).toHaveBeenCalled();

      // Verify Flag was created
      const flags = mockMedplum.getResources('Flag');
      expect(flags.length).toBeGreaterThan(0);
      expect((flags[0] as any).code.text).toContain('Critical potassium');
    });

    it('should create DocumentReference for SummarizePatientHistory', async () => {
      const command: SummarizePatientHistory = {
        command: 'SummarizePatientHistory',
        patientId: 'test-patient-1',
        summaryType: 'comprehensive',
        summary: 'Comprehensive patient summary for testing.',
        keyFindings: ['Finding 1', 'Finding 2'],
        confidence: 0.88,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);

      // Verify DocumentReference was created
      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);
    });
  });

  describe('Audit Logging', () => {
    it('should create AuditEvent for executed commands', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Elevated value',
        confidence: 0.85,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      await handler(mockMedplum as any, event as any);

      // Verify AuditEvent was created
      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBeGreaterThan(0);
    });

    it('should create AuditEvent for blocked commands', async () => {
      const command = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Test',
        confidence: 0.1, // Will be blocked
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBeGreaterThan(0);
    });
  });

  describe('Provenance Tracking', () => {
    it('should create Provenance for executed commands', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Critical value detected',
        confidence: 0.9,
        requiresApproval: false,
        aiModel: 'llama3.2:3b',
      };

      const event = { input: command };
      await handler(mockMedplum as any, event as any);

      const provenances = mockMedplum.getResources('Provenance');
      expect(provenances.length).toBeGreaterThan(0);

      const provenance = provenances[0] as any;
      expect(provenance.agent).toBeDefined();
      expect(provenance.agent[0].who.display).toContain('AI');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown command types gracefully', async () => {
      const command = {
        command: 'UnknownCommand',
        confidence: 0.9,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result = await handler(mockMedplum as any, event as any);

      // Unknown commands should be queued for approval
      expect(result.action).toBe('queued');
    });
  });

  describe('Command ID Generation', () => {
    it('should generate unique command IDs', async () => {
      const command: FlagAbnormalResult = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Test',
        confidence: 0.85,
        requiresApproval: false,
        aiModel: 'test-model',
      };

      const event = { input: command };
      const result1 = await handler(mockMedplum as any, event as any);
      const result2 = await handler(mockMedplum as any, event as any);

      expect(result1.commandId).toBeDefined();
      expect(result2.commandId).toBeDefined();
      expect(result1.commandId).not.toBe(result2.commandId);
    });
  });
});
