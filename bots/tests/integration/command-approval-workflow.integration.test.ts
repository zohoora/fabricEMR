/**
 * Command & Approval Workflow Integration Tests
 *
 * Tests the full workflow: command generation -> processing -> approval queue -> execution
 */

import { handler as commandHandler } from '../../src/command-processor-bot';
import { handler as approvalHandler } from '../../src/approval-queue-bot';
import { handler as cdsHandler } from '../../src/clinical-decision-support-bot';
import { handler as billingHandler } from '../../src/billing-code-suggester-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { setupOllamaMock, teardownOllamaMock } from '../mocks/ollama';
import {
  testPatient,
  officeVisitEncounter,
  getAllTestConditions,
  getAllTestObservations,
  getAllTestMedications,
  criticalLabObservation,
} from '../fixtures/fhir-resources';
import { Task } from '@medplum/fhirtypes';

describe('Command & Approval Workflow Integration', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
      conditions: getAllTestConditions(),
      observations: getAllTestObservations(),
      medications: getAllTestMedications(),
    });
    mockMedplum.addResource(officeVisitEncounter);
    mockMedplum.addResource(criticalLabObservation);
    setupOllamaMock();
  });

  afterEach(() => {
    mockMedplum.reset();
    teardownOllamaMock();
  });

  describe('CDS to Command to Approval Flow', () => {
    it('should generate commands from CDS and process them', async () => {
      // Step 1: Run clinical decision support
      const cdsResult = await cdsHandler(mockMedplum as any, {
        input: {
          patientId: 'test-patient-1',
          analysisTypes: ['critical'],
          generateCommands: true,
        },
      } as any);

      expect(cdsResult.success).toBe(true);

      // Step 2: Process generated commands
      if (cdsResult.commands && cdsResult.commands.length > 0) {
        for (const command of cdsResult.commands) {
          const processResult = await commandHandler(mockMedplum as any, {
            input: command,
          } as any);

          expect(processResult.success).toBeDefined();
          // Commands should either execute or be queued
          expect(['executed', 'queued']).toContain(processResult.action);
        }
      }
    });

    it('should create approval tasks for high-risk commands', async () => {
      // Submit a command that requires approval
      const command = {
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-office-1',
        noteType: 'progress',
        content: 'AI generated note content',
        confidence: 0.85,
        requiresApproval: true,
        aiModel: 'llama3.2:3b',
      };

      const processResult = await commandHandler(mockMedplum as any, {
        input: command,
      } as any);

      expect(processResult.action).toBe('queued');
      expect(processResult.taskId).toBeDefined();

      // Verify Task was created
      const tasks = mockMedplum.getResources('Task');
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should execute command after approval', async () => {
      // First, submit a command that requires approval
      const command = {
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-office-1',
        noteType: 'progress',
        content: 'Clinically reviewed content',
        confidence: 0.9,
        requiresApproval: true,
        aiModel: 'llama3.2:3b',
      };

      await commandHandler(mockMedplum as any, { input: command } as any);

      // Get the created task
      const tasks = mockMedplum.getResources('Task') as Task[];
      expect(tasks.length).toBeGreaterThan(0);

      // Simulate approval by updating task status
      const approvedTask: Task = {
        ...tasks[0],
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
      };

      // Process the approved task
      const approvalResult = await approvalHandler(mockMedplum as any, {
        input: approvedTask,
      } as any);

      expect(approvalResult.success).toBe(true);
      expect(approvalResult.action).toBe('approved');

      // Verify DocumentReference was created
      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);
    });
  });

  describe('Billing Code Workflow', () => {
    it('should generate billing codes and create approval task', async () => {
      // Generate billing suggestions
      const billingResult = await billingHandler(mockMedplum as any, {
        input: {
          patientId: 'test-patient-1',
          encounterId: 'encounter-office-1',
          generateCommand: true,
        },
      } as any);

      expect(billingResult.success).toBe(true);
      expect(billingResult.command).toBeDefined();

      // Process the billing command
      const processResult = await commandHandler(mockMedplum as any, {
        input: billingResult.command,
      } as any);

      // Billing commands always require approval
      expect(processResult.action).toBe('queued');
    });

    it('should create Claim resource after billing approval', async () => {
      // Create a billing task directly (simulating the result of above)
      const billingTask: Task = {
        resourceType: 'Task',
        id: 'billing-task-1',
        status: 'completed',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://medplum.com/ai-command',
              code: 'SuggestBillingCodes',
            },
          ],
        },
        owner: { reference: 'Practitioner/dr-smith' },
        for: { reference: 'Patient/test-patient-1' },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'SuggestBillingCodes',
              patientId: 'test-patient-1',
              encounterId: 'encounter-office-1',
              suggestedCodes: [
                { code: '99213', system: 'CPT', display: 'Office visit', confidence: 0.9 },
                { code: 'I10', system: 'ICD-10-CM', display: 'Hypertension', confidence: 0.95 },
              ],
              confidence: 0.9,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      mockMedplum.addResource(billingTask);

      const approvalResult = await approvalHandler(mockMedplum as any, {
        input: billingTask,
      } as any);

      expect(approvalResult.success).toBe(true);

      // Verify Claim was created
      const claims = mockMedplum.getResources('Claim');
      expect(claims.length).toBeGreaterThan(0);
    });
  });

  describe('Rejection Flow', () => {
    it('should handle rejected commands properly', async () => {
      // Create and reject a task
      const rejectedTask: Task = {
        resourceType: 'Task',
        id: 'rejected-task-1',
        status: 'rejected',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://medplum.com/ai-command',
              code: 'CreateEncounterNoteDraft',
            },
          ],
        },
        owner: { reference: 'Practitioner/dr-smith' },
        for: { reference: 'Patient/test-patient-1' },
        note: [{ text: 'Rejection: Inaccurate clinical assessment' }],
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'CreateEncounterNoteDraft',
              patientId: 'test-patient-1',
              encounterId: 'encounter-office-1',
              noteType: 'progress',
              content: 'Inaccurate content',
              confidence: 0.7,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      mockMedplum.addResource(rejectedTask);

      const result = await approvalHandler(mockMedplum as any, {
        input: rejectedTask,
      } as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('rejected');

      // Verify no DocumentReference was created
      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBe(0);

      // Verify Provenance was created for rejection
      const provenances = mockMedplum.getResources('Provenance');
      expect(provenances.length).toBeGreaterThan(0);
    });
  });

  describe('Modified Commands', () => {
    it('should apply clinician modifications and execute', async () => {
      const modifiedCommand = {
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-office-1',
        noteType: 'progress',
        content: 'CLINICIAN MODIFIED: Corrected assessment',
        confidence: 0.95,
        requiresApproval: true,
        aiModel: 'llama3.2:3b',
      };

      const modifiedTask: Task = {
        resourceType: 'Task',
        id: 'modified-task-1',
        status: 'completed',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://medplum.com/ai-command',
              code: 'CreateEncounterNoteDraft',
            },
          ],
        },
        owner: { reference: 'Practitioner/dr-smith' },
        output: [
          {
            type: { text: 'modifications' },
            valueString: JSON.stringify(modifiedCommand),
          },
        ],
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'CreateEncounterNoteDraft',
              patientId: 'test-patient-1',
              encounterId: 'encounter-office-1',
              noteType: 'progress',
              content: 'Original AI content',
              confidence: 0.8,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      mockMedplum.addResource(modifiedTask);

      const result = await approvalHandler(mockMedplum as any, {
        input: modifiedTask,
      } as any);

      expect(result.success).toBe(true);

      // Verify the modified content was used
      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);

      const doc = docs[0] as any;
      const content = Buffer.from(doc.content[0].attachment.data, 'base64').toString();
      expect(content).toContain('CLINICIAN MODIFIED');
    });
  });

  describe('Audit Trail', () => {
    it('should create audit events throughout the workflow', async () => {
      // Run a command through the full workflow
      const command = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'critical-lab-1',
        severity: 'critical',
        interpretation: 'Critical potassium value',
        confidence: 0.95,
        requiresApproval: false,
        aiModel: 'llama3.2:3b',
      };

      await commandHandler(mockMedplum as any, { input: command } as any);

      // Verify audit events were created
      const audits = mockMedplum.getResources('AuditEvent');
      expect(audits.length).toBeGreaterThan(0);
    });

    it('should create provenance for executed commands', async () => {
      const command = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'critical-lab-1',
        severity: 'high',
        interpretation: 'Elevated value',
        confidence: 0.9,
        requiresApproval: false,
        aiModel: 'llama3.2:3b',
      };

      await commandHandler(mockMedplum as any, { input: command } as any);

      // Verify Provenance was created
      const provenances = mockMedplum.getResources('Provenance');
      expect(provenances.length).toBeGreaterThan(0);

      const provenance = provenances[0] as any;
      expect(provenance.agent).toBeDefined();
      expect(provenance.agent[0].who.display).toContain('AI');
    });
  });

  describe('Safety Filters', () => {
    it('should block low-confidence commands', async () => {
      const lowConfidenceCommand = {
        command: 'FlagAbnormalResult',
        patientId: 'test-patient-1',
        observationId: 'obs-1',
        severity: 'high',
        interpretation: 'Uncertain finding',
        confidence: 0.3, // Below threshold
        requiresApproval: false,
        aiModel: 'llama3.2:3b',
      };

      const result = await commandHandler(mockMedplum as any, {
        input: lowConfidenceCommand,
      } as any);

      expect(result.action).toBe('blocked');
      expect(result.blockReason).toContain('confidence');
    });
  });
});
