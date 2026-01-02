/**
 * AI Audit Logging Bot
 *
 * Comprehensive audit logging for all AI operations.
 * Creates FHIR AuditEvent resources for compliance and traceability.
 *
 * Can be triggered:
 * - Directly by other bots
 * - Via FHIR Subscription on Provenance resources
 * - Via API call for custom audit events
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import { AuditEvent, Reference, Coding } from '@medplum/fhirtypes';

// Configuration
const AUDIT_SOURCE = 'AI Audit System';
const RETENTION_DAYS = 2555; // 7 years for HIPAA compliance

/**
 * Audit Event Types
 */
type AIAuditEventType =
  | 'command_received'
  | 'command_executed'
  | 'command_blocked'
  | 'command_queued'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_timeout'
  | 'safety_filter_triggered'
  | 'embedding_created'
  | 'semantic_search'
  | 'rag_query'
  | 'llm_request'
  | 'llm_response'
  | 'phi_redaction'
  | 'rate_limit_exceeded'
  | 'error';

interface AuditInput {
  eventType: AIAuditEventType;
  action: 'C' | 'R' | 'U' | 'D' | 'E'; // Create, Read, Update, Delete, Execute
  outcome: '0' | '4' | '8' | '12'; // Success, Minor failure, Serious failure, Major failure
  outcomeDesc?: string;
  commandId?: string;
  commandType?: string;
  patientId?: string;
  practitionerId?: string;
  aiModel?: string;
  confidence?: number;
  prompt?: string;
  response?: string;
  safetyFilter?: string;
  blockReason?: string;
  approvalTaskId?: string;
  duration?: number; // milliseconds
  tokensUsed?: number;
  sourceIp?: string;
  userAgent?: string;
  additionalData?: Record<string, any>;
}

interface AuditOutput {
  success: boolean;
  auditEventId?: string;
  message: string;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<AuditOutput> {
  const input = event.input as AuditInput;

  if (!input?.eventType) {
    return {
      success: false,
      message: 'Error: eventType is required',
    };
  }

  console.log(`Creating audit event: ${input.eventType}`);

  try {
    const auditEvent = await createAuditEvent(medplum, input);

    return {
      success: true,
      auditEventId: auditEvent.id,
      message: `Audit event created: ${auditEvent.id}`,
    };
  } catch (error) {
    console.log('Audit logging error:', error);

    // Try to log the failure itself
    try {
      await createFailureAuditEvent(medplum, input, error);
    } catch {
      // Silently fail - we don't want audit failures to break the system
    }

    return {
      success: false,
      message: `Error creating audit event: ${error}`,
    };
  }
}

/**
 * Create FHIR AuditEvent
 */
async function createAuditEvent(medplum: MedplumClient, input: AuditInput): Promise<AuditEvent> {
  const now = new Date().toISOString();

  // Build entity list
  const entities: AuditEvent['entity'] = [];

  // Add command entity
  if (input.commandId || input.commandType) {
    entities.push({
      what: {
        display: input.commandId || 'Unknown Command',
      },
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
        code: '2', // System Object
        display: 'System Object',
      },
      role: {
        system: 'http://terminology.hl7.org/CodeSystem/object-role',
        code: '4', // Domain Resource
        display: 'Domain Resource',
      },
      name: input.commandType,
      detail: buildEntityDetails(input),
    });
  }

  // Add patient entity if present
  if (input.patientId) {
    entities.push({
      what: {
        reference: `Patient/${input.patientId}`,
      },
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
        code: '1', // Person
        display: 'Person',
      },
      role: {
        system: 'http://terminology.hl7.org/CodeSystem/object-role',
        code: '1', // Patient
        display: 'Patient',
      },
    });
  }

  // Add prompt/response as query entity (if configured to log)
  if (input.prompt || input.response) {
    entities.push({
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
        code: '2', // System Object
        display: 'System Object',
      },
      role: {
        system: 'http://terminology.hl7.org/CodeSystem/object-role',
        code: '24', // Query
        display: 'Query',
      },
      query: input.prompt
        ? Buffer.from(truncateString(input.prompt, 10000)).toString('base64')
        : undefined,
      detail: input.response
        ? [
            {
              type: 'response',
              valueBase64Binary: Buffer.from(truncateString(input.response, 10000)).toString(
                'base64'
              ),
            },
          ]
        : undefined,
    });
  }

  // Build agent list
  const agents: AuditEvent['agent'] = [];

  // AI agent
  agents.push({
    type: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
          code: 'authserver',
          display: 'Authorization Server',
        },
      ],
    },
    who: {
      display: input.aiModel ? `AI: ${input.aiModel}` : 'AI System',
    },
    requestor: false,
    network: input.sourceIp
      ? {
          address: input.sourceIp,
          type: '2', // IP Address
        }
      : undefined,
  });

  // Human agent if present
  if (input.practitionerId) {
    agents.push({
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
            code: 'humanuser',
            display: 'Human User',
          },
        ],
      },
      who: {
        reference: input.practitionerId,
      },
      requestor: true,
    });
  }

  const auditEvent = await medplum.createResource<AuditEvent>({
    resourceType: 'AuditEvent',
    type: getAuditEventType(input.eventType),
    subtype: [getAuditEventSubtype(input.eventType)],
    action: input.action,
    period: {
      start: now,
      end: now,
    },
    recorded: now,
    outcome: input.outcome,
    outcomeDesc: input.outcomeDesc || getDefaultOutcomeDesc(input),
    purposeOfEvent: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
            code: 'TREAT',
            display: 'Treatment',
          },
        ],
      },
    ],
    agent: agents,
    source: {
      site: 'Medplum AI Stack',
      observer: {
        display: AUDIT_SOURCE,
      },
      type: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/security-source-type',
          code: '4', // Application Server
          display: 'Application Server',
        },
      ],
    },
    entity: entities,
  });

  return auditEvent;
}

/**
 * Build entity details from input
 */
function buildEntityDetails(input: AuditInput): Array<{ type: string; valueString?: string; valueBase64Binary?: string }> {
  const details: Array<{ type: string; valueString?: string; valueBase64Binary?: string }> = [];

  if (input.confidence !== undefined) {
    details.push({
      type: 'confidence',
      valueString: input.confidence.toString(),
    });
  }

  if (input.duration !== undefined) {
    details.push({
      type: 'duration_ms',
      valueString: input.duration.toString(),
    });
  }

  if (input.tokensUsed !== undefined) {
    details.push({
      type: 'tokens_used',
      valueString: input.tokensUsed.toString(),
    });
  }

  if (input.safetyFilter) {
    details.push({
      type: 'safety_filter',
      valueString: input.safetyFilter,
    });
  }

  if (input.blockReason) {
    details.push({
      type: 'block_reason',
      valueString: input.blockReason,
    });
  }

  if (input.approvalTaskId) {
    details.push({
      type: 'approval_task',
      valueString: input.approvalTaskId,
    });
  }

  if (input.additionalData) {
    details.push({
      type: 'additional_data',
      valueBase64Binary: Buffer.from(JSON.stringify(input.additionalData)).toString('base64'),
    });
  }

  return details;
}

/**
 * Get audit event type coding
 */
function getAuditEventType(eventType: AIAuditEventType): Coding {
  // Map to standard FHIR audit event types
  const typeMap: Record<AIAuditEventType, { code: string; display: string }> = {
    command_received: { code: 'rest', display: 'RESTful Operation' },
    command_executed: { code: 'rest', display: 'RESTful Operation' },
    command_blocked: { code: 'security', display: 'Security' },
    command_queued: { code: 'rest', display: 'RESTful Operation' },
    approval_requested: { code: 'rest', display: 'RESTful Operation' },
    approval_granted: { code: 'rest', display: 'RESTful Operation' },
    approval_denied: { code: 'rest', display: 'RESTful Operation' },
    approval_timeout: { code: 'rest', display: 'RESTful Operation' },
    safety_filter_triggered: { code: 'security', display: 'Security' },
    embedding_created: { code: 'rest', display: 'RESTful Operation' },
    semantic_search: { code: 'rest', display: 'RESTful Operation' },
    rag_query: { code: 'rest', display: 'RESTful Operation' },
    llm_request: { code: 'rest', display: 'RESTful Operation' },
    llm_response: { code: 'rest', display: 'RESTful Operation' },
    phi_redaction: { code: 'security', display: 'Security' },
    rate_limit_exceeded: { code: 'security', display: 'Security' },
    error: { code: 'rest', display: 'RESTful Operation' },
  };

  const type = typeMap[eventType] || { code: 'rest', display: 'RESTful Operation' };

  return {
    system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
    code: type.code,
    display: type.display,
  };
}

/**
 * Get audit event subtype coding
 */
function getAuditEventSubtype(eventType: AIAuditEventType): Coding {
  return {
    system: 'http://medplum.com/fhir/CodeSystem/ai-audit-event',
    code: eventType,
    display: formatEventType(eventType),
  };
}

/**
 * Format event type for display
 */
function formatEventType(eventType: string): string {
  return eventType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get default outcome description
 */
function getDefaultOutcomeDesc(input: AuditInput): string {
  const descriptions: Record<AIAuditEventType, string> = {
    command_received: 'AI command received for processing',
    command_executed: 'AI command executed successfully',
    command_blocked: `AI command blocked${input.blockReason ? `: ${input.blockReason}` : ''}`,
    command_queued: 'AI command queued for approval',
    approval_requested: 'Approval requested from clinician',
    approval_granted: 'AI command approved by clinician',
    approval_denied: 'AI command rejected by clinician',
    approval_timeout: 'AI command approval timeout',
    safety_filter_triggered: `Safety filter triggered: ${input.safetyFilter || 'unknown'}`,
    embedding_created: 'Clinical embedding generated',
    semantic_search: 'Semantic search performed',
    rag_query: 'RAG query processed',
    llm_request: 'LLM request sent',
    llm_response: 'LLM response received',
    phi_redaction: 'PHI redacted from content',
    rate_limit_exceeded: 'Rate limit exceeded for AI operations',
    error: 'Error in AI operation',
  };

  return descriptions[input.eventType] || 'AI operation performed';
}

/**
 * Create audit event for logging failure
 */
async function createFailureAuditEvent(
  medplum: MedplumClient,
  originalInput: AuditInput,
  error: any
): Promise<void> {
  await medplum.createResource<AuditEvent>({
    resourceType: 'AuditEvent',
    type: {
      system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
      code: 'rest',
      display: 'RESTful Operation',
    },
    subtype: [
      {
        system: 'http://medplum.com/fhir/CodeSystem/ai-audit-event',
        code: 'audit_failure',
        display: 'Audit Logging Failure',
      },
    ],
    action: 'E',
    recorded: new Date().toISOString(),
    outcome: '8', // Serious failure
    outcomeDesc: `Failed to create audit event for ${originalInput.eventType}: ${error}`,
    agent: [
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
              code: 'authserver',
            },
          ],
        },
        who: { display: AUDIT_SOURCE },
        requestor: false,
      },
    ],
    source: {
      observer: { display: AUDIT_SOURCE },
    },
  });
}

/**
 * Truncate string to max length
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...[truncated]';
}

/**
 * Helper function to create audit events from other bots
 */
export async function logAIAuditEvent(
  medplum: MedplumClient,
  eventType: AIAuditEventType,
  options: Partial<AuditInput>
): Promise<string | undefined> {
  const input: AuditInput = {
    eventType,
    action: options.action || 'E',
    outcome: options.outcome || '0',
    ...options,
  };

  try {
    const auditEvent = await createAuditEvent(medplum, input);
    return auditEvent.id;
  } catch (error) {
    console.log('Failed to log audit event:', error);
    return undefined;
  }
}

/**
 * Batch audit logging for efficiency
 */
export async function logAIAuditEventBatch(
  medplum: MedplumClient,
  events: AuditInput[]
): Promise<string[]> {
  const ids: string[] = [];

  for (const event of events) {
    try {
      const auditEvent = await createAuditEvent(medplum, event);
      if (auditEvent.id) {
        ids.push(auditEvent.id);
      }
    } catch (error) {
      console.log('Failed to log batch audit event:', error);
    }
  }

  return ids;
}

/**
 * Query audit events for a specific command
 * Searches AuditEvent resources by command ID stored in entity details
 */
export async function getAuditEventsForCommand(
  medplum: MedplumClient,
  commandId: string
): Promise<AuditEvent[]> {
  console.log(`Searching for audit events for command: ${commandId}`);

  try {
    // Search for AuditEvents that have the command ID in their entity
    // We search by entity.what.display which contains the command ID
    const bundle = await medplum.search('AuditEvent', {
      'entity-name': commandId,
      _sort: '-recorded',
      _count: '100',
    });

    const auditEvents: AuditEvent[] = [];

    if (bundle.entry) {
      for (const entry of bundle.entry) {
        if (entry.resource?.resourceType === 'AuditEvent') {
          auditEvents.push(entry.resource as AuditEvent);
        }
      }
    }

    // If no results from entity-name search, try searching by subtype
    // (for events that may have stored commandId differently)
    if (auditEvents.length === 0) {
      const altBundle = await medplum.search('AuditEvent', {
        _content: commandId,
        _sort: '-recorded',
        _count: '100',
      });

      if (altBundle.entry) {
        for (const entry of altBundle.entry) {
          if (entry.resource?.resourceType === 'AuditEvent') {
            auditEvents.push(entry.resource as AuditEvent);
          }
        }
      }
    }

    console.log(`Found ${auditEvents.length} audit events for command: ${commandId}`);
    return auditEvents;
  } catch (error) {
    console.log(`Error searching for audit events: ${error}`);
    return [];
  }
}

export default handler;
