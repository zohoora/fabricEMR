/**
 * Audit Logging Bot - Unit Tests
 */

import { handler, logAIAuditEvent, logAIAuditEventBatch } from '../../src/audit-logging-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';

describe('Audit Logging Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient();
  });

  afterEach(() => {
    mockMedplum.reset();
  });

  describe('Input Validation', () => {
    it('should require eventType', async () => {
      const event = { input: {} };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('eventType');
    });
  });

  describe('Event Types', () => {
    const eventTypes = [
      'command_received',
      'command_executed',
      'command_blocked',
      'command_queued',
      'approval_requested',
      'approval_granted',
      'approval_denied',
      'approval_timeout',
      'safety_filter_triggered',
      'embedding_created',
      'semantic_search',
      'rag_query',
      'llm_request',
      'llm_response',
      'phi_redaction',
      'rate_limit_exceeded',
      'error',
    ];

    eventTypes.forEach((eventType) => {
      it(`should create AuditEvent for ${eventType}`, async () => {
        const event = {
          input: {
            eventType,
            action: 'E',
            outcome: '0',
          },
        };
        const result = await handler(mockMedplum as any, event as any);

        expect(result.success).toBe(true);
        expect(result.auditEventId).toBeDefined();

        const audits = mockMedplum.getResources('AuditEvent');
        expect(audits.length).toBe(1);
      });
    });
  });

  describe('AuditEvent Content', () => {
    it('should include command information', async () => {
      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
          commandId: 'cmd-12345',
          commandType: 'CreateEncounterNoteDraft',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      expect(audit.entity).toBeDefined();
      expect(audit.entity.length).toBeGreaterThan(0);
    });

    it('should include patient reference when provided', async () => {
      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
          patientId: 'patient-123',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const patientEntity = audit.entity.find(
        (e: any) => e.what?.reference?.includes('Patient')
      );
      expect(patientEntity).toBeDefined();
    });

    it('should include practitioner reference when provided', async () => {
      const event = {
        input: {
          eventType: 'approval_granted',
          action: 'E',
          outcome: '0',
          practitionerId: 'Practitioner/dr-smith',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const humanAgent = audit.agent.find(
        (a: any) => a.type?.coding?.[0]?.code === 'humanuser'
      );
      expect(humanAgent).toBeDefined();
    });

    it('should include AI model information', async () => {
      const event = {
        input: {
          eventType: 'llm_request',
          action: 'E',
          outcome: '0',
          aiModel: 'llama3.2:3b',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const aiAgent = audit.agent.find((a: any) => a.who?.display?.includes('AI'));
      expect(aiAgent).toBeDefined();
      expect(aiAgent.who.display).toContain('llama3.2:3b');
    });

    it('should include confidence score in entity details', async () => {
      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
          commandId: 'cmd-123',
          commandType: 'FlagAbnormalResult',
          confidence: 0.87,
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const entityWithDetails = audit.entity.find(
        (e: any) => e.detail?.some((d: any) => d.type === 'confidence')
      );
      expect(entityWithDetails).toBeDefined();
    });
  });

  describe('Outcome Handling', () => {
    it('should set outcome correctly for success', async () => {
      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
          outcomeDesc: 'Command executed successfully',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      expect(audit.outcome).toBe('0');
      expect(audit.outcomeDesc).toContain('successfully');
    });

    it('should set outcome correctly for blocked commands', async () => {
      const event = {
        input: {
          eventType: 'command_blocked',
          action: 'E',
          outcome: '8',
          blockReason: 'Safety filter triggered',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      expect(audit.outcome).toBe('8');
    });
  });

  describe('Prompt/Response Logging', () => {
    it('should store prompt when provided', async () => {
      const event = {
        input: {
          eventType: 'llm_request',
          action: 'E',
          outcome: '0',
          prompt: 'Generate a clinical note for patient with hypertension.',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const queryEntity = audit.entity.find((e: any) => e.query);
      expect(queryEntity).toBeDefined();
    });

    it('should store response when provided', async () => {
      const event = {
        input: {
          eventType: 'llm_response',
          action: 'E',
          outcome: '0',
          response: 'Patient presents with controlled hypertension...',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const entityWithResponse = audit.entity.find(
        (e: any) => e.detail?.some((d: any) => d.type === 'response')
      );
      expect(entityWithResponse).toBeDefined();
    });

    it('should truncate very long prompts', async () => {
      const longPrompt = 'A'.repeat(15000);
      const event = {
        input: {
          eventType: 'llm_request',
          action: 'E',
          outcome: '0',
          prompt: longPrompt,
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBe(1);
      // Should not fail even with very long prompt
    });
  });

  describe('Safety Filter Logging', () => {
    it('should log safety filter name', async () => {
      const event = {
        input: {
          eventType: 'safety_filter_triggered',
          action: 'E',
          outcome: '8',
          commandId: 'cmd-blocked',
          commandType: 'SuggestMedicationChange',
          safetyFilter: 'BlockControlledSubstances',
          blockReason: 'AI cannot prescribe controlled substances',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const entityWithDetails = audit.entity.find(
        (e: any) => e.detail?.some((d: any) => d.type === 'safety_filter')
      );
      expect(entityWithDetails).toBeDefined();
      const filterDetail = entityWithDetails.detail.find((d: any) => d.type === 'safety_filter');
      expect(filterDetail.valueString).toBe('BlockControlledSubstances');
    });
  });

  describe('Helper Functions', () => {
    it('should log events via helper function', async () => {
      const auditId = await logAIAuditEvent(mockMedplum as any, 'command_executed', {
        commandId: 'cmd-123',
        confidence: 0.9,
      });

      expect(auditId).toBeDefined();

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBe(1);
    });

    it('should log batch events', async () => {
      const events = [
        { eventType: 'command_received' as const, action: 'E' as const, outcome: '0' as const },
        { eventType: 'command_executed' as const, action: 'C' as const, outcome: '0' as const },
        { eventType: 'command_blocked' as const, action: 'E' as const, outcome: '8' as const },
      ];

      const ids = await logAIAuditEventBatch(mockMedplum as any, events);

      expect(ids.length).toBe(3);

      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle create errors gracefully', async () => {
      // Make createResource fail
      mockMedplum.createResourceSpy.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
        },
      };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
    });
  });

  describe('Timestamps', () => {
    it('should include recorded timestamp', async () => {
      const event = {
        input: {
          eventType: 'command_executed',
          action: 'C',
          outcome: '0',
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      expect(audit.recorded).toBeDefined();
      expect(new Date(audit.recorded).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Duration Tracking', () => {
    it('should include duration when provided', async () => {
      const event = {
        input: {
          eventType: 'llm_response',
          action: 'E',
          outcome: '0',
          commandId: 'cmd-123',
          commandType: 'RAGQuery',
          duration: 1500, // 1.5 seconds
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const entityWithDetails = audit.entity.find(
        (e: any) => e.detail?.some((d: any) => d.type === 'duration_ms')
      );
      expect(entityWithDetails).toBeDefined();
      const durationDetail = entityWithDetails.detail.find((d: any) => d.type === 'duration_ms');
      expect(durationDetail.valueString).toBe('1500');
    });
  });

  describe('Token Usage Tracking', () => {
    it('should include token count when provided', async () => {
      const event = {
        input: {
          eventType: 'llm_response',
          action: 'E',
          outcome: '0',
          commandId: 'cmd-123',
          commandType: 'RAGQuery',
          tokensUsed: 256,
        },
      };
      await handler(mockMedplum as any, event as any);

      const audits = mockMedplum.getResources('AuditEvent');
      const audit = audits[0] as any;

      const entityWithDetails = audit.entity.find(
        (e: any) => e.detail?.some((d: any) => d.type === 'tokens_used')
      );
      expect(entityWithDetails).toBeDefined();
      const tokenDetail = entityWithDetails.detail.find((d: any) => d.type === 'tokens_used');
      expect(tokenDetail.valueString).toBe('256');
    });
  });
});
