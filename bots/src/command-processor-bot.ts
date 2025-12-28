/**
 * AI Command Processor Bot
 *
 * Central processor for all AI-generated commands.
 * Validates commands against safety rules, routes to approval queue if needed,
 * or executes directly for auto-approved commands.
 *
 * Input: AICommand (from ai-command-types.ts)
 * Output: { success: boolean, action: 'executed' | 'queued' | 'blocked', ... }
 */

import { BotEvent, MedplumClient, createReference } from '@medplum/core';
import { Task, Provenance, AuditEvent, Reference, Flag, DocumentReference } from '@medplum/fhirtypes';
import {
  AICommand,
  AIProvenance,
  DEFAULT_APPROVAL_RULES,
  DEFAULT_SAFETY_FILTERS,
  SafetyFilter,
  ApprovalRule,
} from './types/ai-command-types';

// Configuration
const QUIET_HOURS_START = 22; // 10 PM
const QUIET_HOURS_END = 6; // 6 AM

interface ProcessorOutput {
  success: boolean;
  commandId: string;
  action: 'executed' | 'queued' | 'blocked';
  message: string;
  taskId?: string;
  blockReason?: string;
  warnings?: string[];
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<ProcessorOutput> {
  const command = event.input as AICommand;

  if (!command || !command.command) {
    return {
      success: false,
      commandId: '',
      action: 'blocked',
      message: 'Invalid command: missing command type',
    };
  }

  const commandId = generateCommandId();
  console.log(`Processing AI command: ${command.command} (${commandId})`);

  try {
    // Step 1: Run safety filters
    const safetyResult = runSafetyFilters(command);
    if (safetyResult.blocked) {
      await logAuditEvent(medplum, command, 'blocked', safetyResult.reason || 'Unknown reason');
      return {
        success: false,
        commandId,
        action: 'blocked',
        message: `Command blocked by safety filter: ${safetyResult.filter}`,
        blockReason: safetyResult.reason,
        warnings: safetyResult.warnings,
      };
    }

    // Step 2: Check approval requirements
    const approvalRule = getApprovalRule(command);
    const requiresApproval = checkRequiresApproval(command, approvalRule);

    // Step 3: Check quiet hours
    const isQuietHours = checkQuietHours();
    const quietHoursOverride = isQuietHours && !command.requiresApproval;

    if (requiresApproval || quietHoursOverride) {
      // Queue for approval
      const task = await createApprovalTask(medplum, command, commandId, approvalRule);

      await logAuditEvent(medplum, command, 'queued', `Queued for approval: ${task.id}`);

      return {
        success: true,
        commandId,
        action: 'queued',
        message: quietHoursOverride
          ? 'Command queued for approval (quiet hours active)'
          : 'Command queued for approval',
        taskId: task.id,
        warnings: safetyResult.warnings,
      };
    }

    // Step 4: Execute command directly
    const executionResult = await executeCommand(medplum, command);

    if (executionResult.success) {
      // Create provenance record
      await createAIProvenance(medplum, command, executionResult.resourceId);
      await logAuditEvent(medplum, command, 'executed', `Executed successfully: ${executionResult.resourceId}`);
    }

    return {
      success: executionResult.success,
      commandId,
      action: 'executed',
      message: executionResult.message,
      warnings: safetyResult.warnings,
    };
  } catch (error) {
    console.error('Command processor error:', error);
    await logAuditEvent(medplum, command, 'error', String(error));

    return {
      success: false,
      commandId,
      action: 'blocked',
      message: `Error processing command: ${error}`,
    };
  }
}

/**
 * Generate unique command ID
 */
function generateCommandId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Run safety filters against command
 */
function runSafetyFilters(command: AICommand): {
  blocked: boolean;
  filter?: string;
  reason?: string;
  warnings: string[];
} {
  const warnings: string[] = [];

  for (const filter of DEFAULT_SAFETY_FILTERS) {
    if (!filter.enabled) continue;

    const matches = evaluateFilterConditions(command, filter);

    if (matches) {
      switch (filter.action) {
        case 'block':
          return {
            blocked: true,
            filter: filter.name,
            reason: filter.description,
            warnings,
          };
        case 'warn':
          warnings.push(`Warning: ${filter.description}`);
          break;
        case 'require_approval':
          // This will be handled by approval logic
          warnings.push(`Note: ${filter.description} - requires approval`);
          break;
      }
    }
  }

  // Check confidence threshold
  if (command.confidence < 0.5) {
    return {
      blocked: true,
      filter: 'LowConfidenceBlock',
      reason: `Command confidence (${command.confidence}) is below minimum threshold (0.5)`,
      warnings,
    };
  }

  return { blocked: false, warnings };
}

/**
 * Evaluate filter conditions against command
 */
function evaluateFilterConditions(command: AICommand, filter: SafetyFilter): boolean {
  for (const condition of filter.conditions) {
    const value = getNestedValue(command, condition.field);

    switch (condition.operator) {
      case 'equals':
        if (value !== condition.value) return false;
        break;
      case 'contains':
        if (typeof value !== 'string' || !value.includes(String(condition.value))) return false;
        break;
      case 'matches':
        if (typeof value !== 'string' || !new RegExp(String(condition.value)).test(value)) return false;
        break;
      case 'greater_than':
        if (typeof value !== 'number' || value <= Number(condition.value)) return false;
        break;
      case 'less_than':
        if (typeof value !== 'number' || value >= Number(condition.value)) return false;
        break;
    }
  }

  return true;
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, p) => o?.[p], obj);
}

/**
 * Get approval rule for command
 */
function getApprovalRule(command: AICommand): ApprovalRule {
  return DEFAULT_APPROVAL_RULES[command.command] || {
    requiresApproval: true,
    approverRoles: ['Practitioner'],
    timeout: '24h',
    auditRequired: true,
  };
}

/**
 * Check if command requires approval
 */
function checkRequiresApproval(command: AICommand, rule: ApprovalRule): boolean {
  if (typeof rule.requiresApproval === 'function') {
    return rule.requiresApproval(command);
  }
  return rule.requiresApproval;
}

/**
 * Check if current time is within quiet hours
 */
function checkQuietHours(): boolean {
  const hour = new Date().getHours();
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/**
 * Create approval task
 */
async function createApprovalTask(
  medplum: MedplumClient,
  command: AICommand,
  commandId: string,
  rule: ApprovalRule
): Promise<Task> {
  const expirationDate = calculateExpiration(rule.timeout);

  const task = await medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'requested',
    intent: 'proposal',
    priority: command.command === 'FlagAbnormalResult' ? 'urgent' : 'routine',
    code: {
      coding: [
        {
          system: 'http://medplum.com/fhir/CodeSystem/ai-command',
          code: command.command,
          display: `AI Command: ${command.command}`,
        },
      ],
    },
    description: `AI-generated ${command.command} requiring approval`,
    authoredOn: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    restriction: {
      period: {
        end: expirationDate,
      },
    },
    input: [
      {
        type: { text: 'command' },
        valueString: JSON.stringify(command),
      },
      {
        type: { text: 'commandId' },
        valueString: commandId,
      },
      {
        type: { text: 'confidence' },
        valueDecimal: command.confidence,
      },
      {
        type: { text: 'aiModel' },
        valueString: command.aiModel,
      },
    ],
    note: command.reasoning
      ? [{ text: `AI Reasoning: ${command.reasoning}` }]
      : undefined,
  });

  return task;
}

/**
 * Calculate expiration date from timeout string
 */
function calculateExpiration(timeout: string): string {
  const now = new Date();
  const match = timeout.match(/^(\d+)([hdwm])$/);

  if (!match) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // Default 24h
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'h':
      now.setHours(now.getHours() + value);
      break;
    case 'd':
      now.setDate(now.getDate() + value);
      break;
    case 'w':
      now.setDate(now.getDate() + value * 7);
      break;
    case 'm':
      now.setMonth(now.getMonth() + value);
      break;
  }

  return now.toISOString();
}

/**
 * Execute command directly (for auto-approved commands)
 */
async function executeCommand(
  medplum: MedplumClient,
  command: AICommand
): Promise<{ success: boolean; message: string; resourceId?: string }> {
  switch (command.command) {
    case 'FlagAbnormalResult':
      // Create a flag/alert for the abnormal result
      const flag = await medplum.createResource<Flag>({
        resourceType: 'Flag',
        status: 'active',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/flag-category',
                code: 'clinical',
                display: 'Clinical',
              },
            ],
          },
        ],
        code: {
          text: `AI Alert: ${command.interpretation}`,
        },
        subject: { reference: `Patient/${command.patientId}` },
        period: { start: new Date().toISOString() },
      });

      return {
        success: true,
        message: `Created abnormal result flag: ${flag.id}`,
        resourceId: flag.id,
      };

    case 'SummarizePatientHistory':
      // Store summary as a DocumentReference
      const doc = await medplum.createResource<DocumentReference>({
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
          text: 'AI-Generated Patient Summary',
        },
        subject: { reference: `Patient/${command.patientId}` },
        date: new Date().toISOString(),
        content: [
          {
            attachment: {
              contentType: 'text/plain',
              data: Buffer.from(command.summary).toString('base64'),
            },
          },
        ],
      });

      return {
        success: true,
        message: `Created patient summary: ${doc.id}`,
        resourceId: doc.id,
      };

    default:
      return {
        success: false,
        message: `Command ${command.command} requires manual approval`,
      };
  }
}

/**
 * Create AI Provenance record
 */
async function createAIProvenance(
  medplum: MedplumClient,
  command: AICommand,
  targetResourceId?: string
): Promise<Provenance> {
  const provenance = await medplum.createResource<Provenance>({
    resourceType: 'Provenance',
    target: targetResourceId
      ? [{ reference: targetResourceId }]
      : [],
    recorded: new Date().toISOString(),
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
          code: 'CREATE',
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
    ],
    entity: [
      {
        role: 'source',
        what: { display: command.promptTemplate || 'default-template' },
      },
    ],
  });

  return provenance;
}

/**
 * Log audit event
 */
async function logAuditEvent(
  medplum: MedplumClient,
  command: AICommand,
  action: string,
  outcome: string
): Promise<void> {
  try {
    await medplum.createResource<AuditEvent>({
      resourceType: 'AuditEvent',
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
        code: 'rest',
        display: 'RESTful Operation',
      },
      subtype: [
        {
          system: 'http://medplum.com/fhir/CodeSystem/ai-audit',
          code: command.command,
          display: `AI Command: ${command.command}`,
        },
      ],
      action: action === 'executed' ? 'C' : 'R',
      recorded: new Date().toISOString(),
      outcome: action === 'blocked' ? '8' : '0', // 8 = serious failure, 0 = success
      outcomeDesc: outcome,
      agent: [
        {
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
                code: 'humanuser',
              },
            ],
          },
          who: { display: `AI: ${command.aiModel}` },
          requestor: true,
        },
      ],
      source: {
        observer: { display: 'AI Command Processor' },
      },
      entity: [
        {
          what: { display: JSON.stringify({ command: command.command, confidence: command.confidence }) },
          type: {
            system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
            code: '2',
            display: 'System Object',
          },
        },
      ],
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

export default handler;
