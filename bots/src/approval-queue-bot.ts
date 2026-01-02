/**
 * Approval Queue Bot
 *
 * Handles the approval workflow for AI-generated commands.
 * Triggered when a Task is updated (approved/rejected by clinician).
 *
 * Trigger: FHIR Subscription on Task update where code = ai-command
 */

import { BotEvent, MedplumClient, createReference } from '@medplum/core';
import { Task, Provenance, Communication, DocumentReference, Condition, Claim, ServiceRequest, MedicationRequest } from '@medplum/fhirtypes';
import { AICommand, AIProvenance } from './types/ai-command-types';

interface ApprovalResult {
  success: boolean;
  action: 'approved' | 'rejected' | 'expired' | 'pending';
  message: string;
  executedResourceId?: string;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<ApprovalResult> {
  const task = event.input as Task;

  if (!task || task.resourceType !== 'Task') {
    return {
      success: false,
      action: 'pending',
      message: 'Invalid input: expected Task resource',
    };
  }

  // Check if this is an AI command task
  const isAICommand = task.code?.coding?.some(
    (c) => c.system === 'http://medplum.com/fhir/CodeSystem/ai-command'
  );

  if (!isAICommand) {
    return {
      success: false,
      action: 'pending',
      message: 'Not an AI command task',
    };
  }

  console.log(`Processing approval task: ${task.id}, status: ${task.status}`);

  try {
    // Extract the original command
    const commandInput = task.input?.find((i) => i.type?.text === 'command');
    if (!commandInput?.valueString) {
      return {
        success: false,
        action: 'pending',
        message: 'No command found in task',
      };
    }

    const command = JSON.parse(commandInput.valueString) as AICommand;

    // Handle based on task status
    switch (task.status) {
      case 'completed':
        return await handleApproval(medplum, task, command);

      case 'rejected':
      case 'cancelled':
        return await handleRejection(medplum, task, command);

      case 'failed':
        return await handleExpiration(medplum, task, command);

      default:
        // Check for expiration
        if (isExpired(task)) {
          return await handleExpiration(medplum, task, command);
        }

        return {
          success: true,
          action: 'pending',
          message: 'Task is still pending approval',
        };
    }
  } catch (error) {
    console.log('Approval queue error:', error);
    return {
      success: false,
      action: 'pending',
      message: `Error processing approval: ${error}`,
    };
  }
}

/**
 * Handle approved command
 */
async function handleApproval(
  medplum: MedplumClient,
  task: Task,
  command: AICommand
): Promise<ApprovalResult> {
  console.log(`Command approved: ${command.command}`);

  // Get approver information
  const approver = task.owner?.reference || 'Unknown';

  // Get any modifications from task output
  const modifications = task.output?.find((o) => o.type?.text === 'modifications');
  const modifiedCommand = modifications?.valueString
    ? JSON.parse(modifications.valueString)
    : command;

  // Execute the command
  const result = await executeApprovedCommand(medplum, modifiedCommand);

  if (result.success && result.resourceId) {
    // Create provenance with clinician approval
    await createApprovalProvenance(medplum, command, result.resourceId, approver, 'accepted', modifications?.valueString);

    // Notify relevant parties
    await sendApprovalNotification(medplum, task, command, 'approved', result.resourceId);
  }

  return {
    success: result.success,
    action: 'approved',
    message: result.message,
    executedResourceId: result.resourceId,
  };
}

/**
 * Handle rejected command
 */
async function handleRejection(
  medplum: MedplumClient,
  task: Task,
  command: AICommand
): Promise<ApprovalResult> {
  console.log(`Command rejected: ${command.command}`);

  // Get rejection reason
  const rejectionNote = task.note?.find((n) => n.text?.includes('Rejection:'));
  const rejectionReason = rejectionNote?.text?.replace('Rejection: ', '') || 'No reason provided';

  const approver = task.owner?.reference || 'Unknown';

  // Create provenance for rejection
  await createApprovalProvenance(medplum, command, undefined, approver, 'rejected', undefined, rejectionReason);

  // Notify relevant parties
  await sendApprovalNotification(medplum, task, command, 'rejected');

  return {
    success: true,
    action: 'rejected',
    message: `Command rejected: ${rejectionReason}`,
  };
}

/**
 * Handle expired command
 */
async function handleExpiration(
  medplum: MedplumClient,
  task: Task,
  command: AICommand
): Promise<ApprovalResult> {
  console.log(`Command expired: ${command.command}`);

  // Update task status
  await medplum.updateResource({
    ...task,
    status: 'failed',
    statusReason: { text: 'Approval timeout expired' },
  });

  // Notify relevant parties
  await sendApprovalNotification(medplum, task, command, 'expired');

  return {
    success: true,
    action: 'expired',
    message: 'Command expired without approval',
  };
}

/**
 * Check if task is expired
 */
function isExpired(task: Task): boolean {
  const expiration = task.restriction?.period?.end;
  if (!expiration) return false;

  return new Date(expiration) < new Date();
}

/**
 * Execute an approved command
 */
async function executeApprovedCommand(
  medplum: MedplumClient,
  command: AICommand
): Promise<{ success: boolean; message: string; resourceId?: string }> {
  switch (command.command) {
    case 'CreateEncounterNoteDraft': {
      const note = await medplum.createResource<DocumentReference>({
        resourceType: 'DocumentReference',
        status: 'current',
        type: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '11506-3',
              display: 'Progress note',
            },
          ],
          text: `${command.noteType} Note`,
        },
        subject: { reference: `Patient/${command.patientId}` },
        context: {
          encounter: [{ reference: `Encounter/${command.encounterId}` }],
        },
        date: new Date().toISOString(),
        content: [
          {
            attachment: {
              contentType: 'text/plain',
              data: Buffer.from(command.content).toString('base64'),
            },
          },
        ],
      });

      return {
        success: true,
        message: `Created encounter note: ${note.id}`,
        resourceId: `DocumentReference/${note.id}`,
      };
    }

    case 'ProposeProblemListUpdate': {
      if (command.action === 'add') {
        const condition = await medplum.createResource<Condition>({
          resourceType: 'Condition',
          clinicalStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                code: command.clinicalStatus || 'active',
              },
            ],
          },
          verificationStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
                code: command.verificationStatus || 'confirmed',
              },
            ],
          },
          code: {
            coding: [
              {
                system: command.condition.system,
                code: command.condition.code,
                display: command.condition.display,
              },
            ],
            text: command.condition.display,
          },
          subject: { reference: `Patient/${command.patientId}` },
          onsetDateTime: command.onsetDate,
        });

        return {
          success: true,
          message: `Added condition: ${condition.id}`,
          resourceId: `Condition/${condition.id}`,
        };
      } else if (command.action === 'resolve') {
        // Would need existing condition ID to resolve
        return {
          success: false,
          message: 'Resolve action requires existing condition ID',
        };
      }

      return {
        success: false,
        message: `Unsupported action: ${command.action}`,
      };
    }

    case 'SuggestBillingCodes': {
      // Create a Claim draft with suggested codes
      const claim = await medplum.createResource<Claim>({
        resourceType: 'Claim',
        status: 'draft',
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/claim-type',
              code: 'professional',
            },
          ],
        },
        use: 'claim',
        patient: { reference: `Patient/${command.patientId}` },
        created: new Date().toISOString(),
        provider: { display: 'AI Suggested' },
        priority: { coding: [{ code: 'normal' }] },
        insurance: [
          {
            sequence: 1,
            focal: true,
            coverage: { display: 'To be determined' },
          },
        ],
        diagnosis: command.suggestedCodes
          .filter((c) => c.system === 'ICD-10-CM')
          .map((c, i) => ({
            sequence: i + 1,
            diagnosisCodeableConcept: {
              coding: [
                {
                  system: 'http://hl7.org/fhir/sid/icd-10-cm',
                  code: c.code,
                  display: c.display,
                },
              ],
            },
          })),
        item: command.suggestedCodes
          .filter((c) => c.system === 'CPT' || c.system === 'HCPCS')
          .map((c, i) => ({
            sequence: i + 1,
            productOrService: {
              coding: [
                {
                  system: c.system === 'CPT'
                    ? 'http://www.ama-assn.org/go/cpt'
                    : 'https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets',
                  code: c.code,
                  display: c.display,
                },
              ],
            },
          })),
      });

      return {
        success: true,
        message: `Created claim draft with ${command.suggestedCodes.length} codes: ${claim.id}`,
        resourceId: `Claim/${claim.id}`,
      };
    }

    case 'QueueReferralLetter': {
      const serviceRequest = await medplum.createResource<ServiceRequest>({
        resourceType: 'ServiceRequest',
        status: 'draft',
        intent: 'proposal',
        priority: command.urgency === 'emergent' ? 'stat' : command.urgency === 'urgent' ? 'urgent' : 'routine',
        code: {
          text: `Referral to ${command.specialty}`,
        },
        subject: { reference: `Patient/${command.patientId}` },
        requester: { reference: command.referringPractitionerId },
        performer: command.recipientPractitionerId
          ? [{ reference: command.recipientPractitionerId }]
          : undefined,
        reasonCode: [{ text: command.reasonForReferral }],
        note: [
          { text: command.clinicalSummary },
          ...(command.specificQuestions?.map((q) => ({ text: `Question: ${q}` })) || []),
        ],
      });

      return {
        success: true,
        message: `Created referral request: ${serviceRequest.id}`,
        resourceId: `ServiceRequest/${serviceRequest.id}`,
      };
    }

    case 'SuggestMedicationChange': {
      const medicationRequest = await medplum.createResource<MedicationRequest>({
        resourceType: 'MedicationRequest',
        status: 'draft',
        intent: 'proposal',
        medicationCodeableConcept: {
          coding: [
            {
              system: command.medication.system,
              code: command.medication.code,
              display: command.medication.display,
            },
          ],
          text: command.medication.display,
        },
        subject: { reference: `Patient/${command.patientId}` },
        dosageInstruction: command.dosage
          ? [
              {
                text: `${command.dosage}${command.frequency ? ` ${command.frequency}` : ''}${
                  command.duration ? ` for ${command.duration}` : ''
                }`,
              },
            ]
          : undefined,
        note: [{ text: `AI Rationale: ${command.rationale}` }],
      });

      return {
        success: true,
        message: `Created medication request draft: ${medicationRequest.id}`,
        resourceId: `MedicationRequest/${medicationRequest.id}`,
      };
    }

    default:
      return {
        success: false,
        message: `Unknown command type: ${command.command}`,
      };
  }
}

/**
 * Create provenance record for approval
 */
async function createApprovalProvenance(
  medplum: MedplumClient,
  command: AICommand,
  targetResourceId: string | undefined,
  approver: string,
  action: 'accepted' | 'edited' | 'rejected',
  modifications?: string,
  rejectionReason?: string
): Promise<Provenance> {
  return medplum.createResource<Provenance>({
    resourceType: 'Provenance',
    target: targetResourceId ? [{ reference: targetResourceId }] : [],
    recorded: new Date().toISOString(),
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
          code: action === 'rejected' ? 'NULLIFY' : 'CREATE',
        },
      ],
    },
    agent: [
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
              code: 'assembler',
            },
          ],
        },
        who: { display: `AI: ${command.aiModel}` },
      },
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
              code: 'verifier',
            },
          ],
        },
        who: { reference: approver },
      },
    ],
    entity: [
      {
        role: 'source',
        what: { display: `AI Command: ${command.command}` },
      },
    ],
    signature: modifications || rejectionReason
      ? [
          {
            type: [
              {
                system: 'urn:iso-astm:E1762-95:2013',
                code: action === 'rejected' ? '1.2.840.10065.1.12.1.2' : '1.2.840.10065.1.12.1.1',
              },
            ],
            when: new Date().toISOString(),
            who: { reference: approver },
            data: Buffer.from(
              JSON.stringify({
                action,
                modifications: modifications ? JSON.parse(modifications) : undefined,
                rejectionReason,
              })
            ).toString('base64'),
          },
        ]
      : undefined,
  });
}

/**
 * Send notification about approval status
 */
async function sendApprovalNotification(
  medplum: MedplumClient,
  task: Task,
  command: AICommand,
  status: 'approved' | 'rejected' | 'expired',
  resourceId?: string
): Promise<void> {
  try {
    const message = status === 'approved'
      ? `AI command ${command.command} was approved and executed. Resource: ${resourceId}`
      : status === 'rejected'
      ? `AI command ${command.command} was rejected.`
      : `AI command ${command.command} expired without approval.`;

    await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'completed',
      category: [
        {
          coding: [
            {
              system: 'http://medplum.com/fhir/CodeSystem/communication-category',
              code: 'ai-notification',
              display: 'AI System Notification',
            },
          ],
        },
      ],
      priority: status === 'expired' ? 'urgent' : 'routine',
      subject: task.for as { reference: string },
      sent: new Date().toISOString(),
      payload: [{ contentString: message }],
    });
  } catch (error) {
    console.log('Failed to send notification:', error);
  }
}

export default handler;
