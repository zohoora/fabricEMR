/**
 * Approval Queue Bot - Unit Tests
 */

import { handler } from '../../src/approval-queue-bot';
import { MockMedplumClient, createMockMedplumClient } from '../mocks/medplum-client';
import { testPatient, pendingApprovalTask, officeVisitEncounter } from '../fixtures/fhir-resources';
import { Task } from '@medplum/fhirtypes';

describe('Approval Queue Bot', () => {
  let mockMedplum: MockMedplumClient;

  beforeEach(() => {
    mockMedplum = createMockMedplumClient({
      patients: [testPatient],
    });
    mockMedplum.addResource(officeVisitEncounter);
  });

  afterEach(() => {
    mockMedplum.reset();
  });

  describe('Input Validation', () => {
    it('should reject non-Task resources', async () => {
      const event = { input: { resourceType: 'Patient' } };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.action).toBe('pending');
      expect(result.message).toContain('Invalid input');
    });

    it('should reject non-AI command tasks', async () => {
      const regularTask: Task = {
        resourceType: 'Task',
        id: 'task-regular',
        status: 'requested',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://example.org/task-type',
              code: 'regular-task',
            },
          ],
        },
      };

      const event = { input: regularTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.action).toBe('pending');
      expect(result.message).toContain('Not an AI command task');
    });
  });

  describe('Pending Tasks', () => {
    it('should recognize pending tasks', async () => {
      const event = { input: pendingApprovalTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('pending');
      expect(result.message).toContain('pending approval');
    });
  });

  describe('Approved Tasks', () => {
    it('should execute approved CreateEncounterNoteDraft command', async () => {
      const approvedTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
      };

      const event = { input: approvedTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('approved');
      expect(result.executedResourceId).toBeDefined();

      // Verify DocumentReference was created
      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);
    });

    it('should create Provenance for approved commands', async () => {
      const approvedTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
      };

      const event = { input: approvedTask };
      await handler(mockMedplum as any, event as any);

      const provenances = mockMedplum.getResources('Provenance');
      expect(provenances.length).toBeGreaterThan(0);

      const provenance = provenances[0] as any;
      expect(provenance.agent.length).toBe(2); // AI + verifier
    });

    it('should send notification for approved commands', async () => {
      const approvedTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        for: { reference: 'Patient/test-patient-1' },
      };

      const event = { input: approvedTask };
      await handler(mockMedplum as any, event as any);

      const communications = mockMedplum.getResources('Communication');
      expect(communications.length).toBeGreaterThan(0);

      const comm = communications[0] as any;
      expect(comm.payload[0].contentString).toContain('approved');
    });
  });

  describe('Rejected Tasks', () => {
    it('should handle rejected tasks', async () => {
      const rejectedTask: Task = {
        ...pendingApprovalTask,
        status: 'rejected',
        owner: { reference: 'Practitioner/dr-smith' },
        note: [{ text: 'Rejection: Incorrect diagnosis suggested' }],
      };

      const event = { input: rejectedTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('rejected');
      expect(result.message).toContain('Incorrect diagnosis');
    });

    it('should create Provenance for rejected commands', async () => {
      const rejectedTask: Task = {
        ...pendingApprovalTask,
        status: 'rejected',
        owner: { reference: 'Practitioner/dr-smith' },
        note: [{ text: 'Rejection: Not clinically appropriate' }],
      };

      const event = { input: rejectedTask };
      await handler(mockMedplum as any, event as any);

      const provenances = mockMedplum.getResources('Provenance');
      expect(provenances.length).toBeGreaterThan(0);
    });

    it('should send notification for rejected commands', async () => {
      const rejectedTask: Task = {
        ...pendingApprovalTask,
        status: 'rejected',
        owner: { reference: 'Practitioner/dr-smith' },
        for: { reference: 'Patient/test-patient-1' },
      };

      const event = { input: rejectedTask };
      await handler(mockMedplum as any, event as any);

      const communications = mockMedplum.getResources('Communication');
      expect(communications.length).toBeGreaterThan(0);

      const comm = communications[0] as any;
      expect(comm.payload[0].contentString).toContain('rejected');
    });
  });

  describe('Expired Tasks', () => {
    it('should handle expired tasks', async () => {
      const expiredTask: Task = {
        ...pendingApprovalTask,
        status: 'requested',
        restriction: {
          period: {
            end: '2020-01-01T00:00:00Z', // In the past
          },
        },
      };

      // Add the task to the mock store so it can be updated
      mockMedplum.addResource(expiredTask);

      const event = { input: expiredTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('expired');
    });

    it('should update task status to failed when expired', async () => {
      const expiredTask: Task = {
        ...pendingApprovalTask,
        status: 'requested',
        restriction: {
          period: {
            end: '2020-01-01T00:00:00Z',
          },
        },
      };

      mockMedplum.addResource(expiredTask);

      const event = { input: expiredTask };
      await handler(mockMedplum as any, event as any);

      expect(mockMedplum.updateResourceSpy).toHaveBeenCalled();
    });
  });

  describe('Modified Commands', () => {
    it('should apply modifications from task output', async () => {
      const modifiedCommand = {
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-office-1',
        noteType: 'progress',
        content: 'MODIFIED: Clinician-edited note content',
        confidence: 0.85,
        requiresApproval: true,
        aiModel: 'llama3.2:3b',
      };

      const approvedTaskWithMods: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        output: [
          {
            type: { text: 'modifications' },
            valueString: JSON.stringify(modifiedCommand),
          },
        ],
      };

      const event = { input: approvedTaskWithMods };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);

      const docs = mockMedplum.getResources('DocumentReference');
      expect(docs.length).toBeGreaterThan(0);

      // The content should contain the modified text
      const doc = docs[0] as any;
      const content = Buffer.from(doc.content[0].attachment.data, 'base64').toString();
      expect(content).toContain('MODIFIED');
    });
  });

  describe('Command Type Handling', () => {
    it('should handle ProposeProblemListUpdate - add action', async () => {
      const problemListTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'ProposeProblemListUpdate',
              patientId: 'test-patient-1',
              action: 'add',
              condition: {
                code: 'I10',
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                display: 'Essential hypertension',
              },
              clinicalStatus: 'active',
              confidence: 0.9,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      const event = { input: problemListTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('approved');

      const conditions = mockMedplum.getResources('Condition');
      expect(conditions.length).toBeGreaterThan(0);
    });

    it('should handle SuggestBillingCodes', async () => {
      const billingTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'SuggestBillingCodes',
              patientId: 'test-patient-1',
              encounterId: 'encounter-office-1',
              suggestedCodes: [
                { code: '99213', system: 'CPT', display: 'Office visit', confidence: 0.9 },
                { code: 'I10', system: 'ICD-10-CM', display: 'HTN', confidence: 0.85 },
              ],
              confidence: 0.85,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      const event = { input: billingTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);

      const claims = mockMedplum.getResources('Claim');
      expect(claims.length).toBeGreaterThan(0);
    });

    it('should handle QueueReferralLetter', async () => {
      const referralTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'QueueReferralLetter',
              patientId: 'test-patient-1',
              referringPractitionerId: 'Practitioner/dr-smith',
              specialty: 'Cardiology',
              urgency: 'routine',
              reasonForReferral: 'Uncontrolled hypertension',
              clinicalSummary: 'Patient with HTN not responding to initial therapy.',
              confidence: 0.88,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      const event = { input: referralTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);

      const serviceRequests = mockMedplum.getResources('ServiceRequest');
      expect(serviceRequests.length).toBeGreaterThan(0);
    });

    it('should handle SuggestMedicationChange', async () => {
      const medChangeTask: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        owner: { reference: 'Practitioner/dr-smith' },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'SuggestMedicationChange',
              patientId: 'test-patient-1',
              action: 'start',
              medication: {
                code: '314076',
                system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                display: 'Lisinopril 10mg',
              },
              dosage: '10mg',
              frequency: 'once daily',
              rationale: 'For blood pressure control',
              confidence: 0.82,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      };

      const event = { input: medChangeTask };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(true);

      const medRequests = mockMedplum.getResources('MedicationRequest');
      expect(medRequests.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing command in task input', async () => {
      const taskWithoutCommand: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        input: [], // No command input
      };

      const event = { input: taskWithoutCommand };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No command found');
    });

    it('should handle invalid JSON in command', async () => {
      const taskWithBadJson: Task = {
        ...pendingApprovalTask,
        status: 'completed',
        input: [
          {
            type: { text: 'command' },
            valueString: 'not valid json',
          },
        ],
      };

      const event = { input: taskWithBadJson };
      const result = await handler(mockMedplum as any, event as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error');
    });
  });
});
