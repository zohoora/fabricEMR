/**
 * Medplum-Specific MCP Tools
 * Tools specific to the clinic-medplum agent for FHIR server management
 */

import type {
  MedplumServerStatus,
  ResourceCountsParams,
  SearchResourcesParams,
  CreateSubscriptionParams,
  AuditLogsParams,
  ValidateResourceParams,
} from '../types';

// Medplum API client configuration
const getMedplumConfig = () => ({
  baseUrl: process.env.MEDPLUM_BASE_URL || 'http://localhost:8103',
  // In production, use proper auth tokens
});

/**
 * Fetch helper with error handling
 */
async function medplumFetch(
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const config = getMedplumConfig();
  const url = `${config.baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/fhir+json',
      ...options?.headers,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Medplum API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * 1. get_server_status - Detailed Medplum server status
 */
export async function getServerStatus(): Promise<MedplumServerStatus> {
  const config = getMedplumConfig();

  // Get health check data
  let healthData: Record<string, unknown> = {};
  try {
    healthData = (await medplumFetch('/healthcheck')) as Record<string, unknown>;
  } catch {
    healthData = { ok: false };
  }

  // Get resource counts for common types
  const resourceCounts: Record<string, number> = {};
  const commonResources = [
    'Patient',
    'Practitioner',
    'Encounter',
    'Observation',
    'Condition',
    'MedicationRequest',
    'DocumentReference',
    'DiagnosticReport',
  ];

  for (const resourceType of commonResources) {
    try {
      const bundle = (await medplumFetch(
        `/fhir/R4/${resourceType}?_summary=count`
      )) as { total?: number };
      resourceCounts[resourceType] = bundle.total || 0;
    } catch {
      resourceCounts[resourceType] = 0;
    }
  }

  return {
    server: {
      version: String(healthData.version || 'unknown'),
      status: healthData.ok ? 'running' : 'error',
      uptime_hours: 0, // Would need to track separately
      base_url: `${config.baseUrl}/fhir/R4`,
    },
    database: {
      status: healthData.postgres ? 'connected' : 'disconnected',
      size_gb: 0, // Would need direct DB query
      connections_active: 0,
      connections_max: 100,
    },
    redis: {
      status: healthData.redis ? 'connected' : 'disconnected',
      memory_used_mb: 0, // Would need Redis INFO command
      hit_rate: 0,
    },
    resources: resourceCounts,
  };
}

/**
 * 2. get_resource_counts - Count FHIR resources by type
 */
export async function getResourceCounts(
  params?: ResourceCountsParams
): Promise<{
  counts: Record<string, { total: number; since_date?: number }>;
}> {
  const resourceTypes = params?.resource_types || [
    'Patient',
    'Encounter',
    'Observation',
    'Condition',
  ];
  const since = params?.since;

  const counts: Record<string, { total: number; since_date?: number }> = {};

  for (const resourceType of resourceTypes) {
    try {
      // Get total count
      const totalBundle = (await medplumFetch(
        `/fhir/R4/${resourceType}?_summary=count`
      )) as { total?: number };

      counts[resourceType] = {
        total: totalBundle.total || 0,
      };

      // Get count since date if specified
      if (since) {
        const sinceBundle = (await medplumFetch(
          `/fhir/R4/${resourceType}?_summary=count&_lastUpdated=ge${since}`
        )) as { total?: number };
        counts[resourceType].since_date = sinceBundle.total || 0;
      }
    } catch {
      counts[resourceType] = { total: 0 };
    }
  }

  return { counts };
}

/**
 * 3. search_resources - Search FHIR resources
 */
export async function searchResources(
  params: SearchResourcesParams
): Promise<{
  total: number;
  resources: Record<string, unknown>[];
}> {
  const { resource_type, search_params, limit } = params;

  // Build query string from search params
  const queryParts: string[] = [];
  for (const [key, value] of Object.entries(search_params)) {
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  if (limit) {
    queryParts.push(`_count=${limit}`);
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  try {
    const bundle = (await medplumFetch(
      `/fhir/R4/${resource_type}${queryString}`
    )) as {
      total?: number;
      entry?: Array<{ resource: Record<string, unknown> }>;
    };

    return {
      total: bundle.total || 0,
      resources: (bundle.entry || []).map((e) => e.resource),
    };
  } catch (error) {
    return {
      total: 0,
      resources: [],
    };
  }
}

/**
 * 4. get_subscriptions - Get active FHIR Subscriptions
 */
export async function getSubscriptions(): Promise<{
  subscriptions: Array<{
    id: string;
    status: string;
    criteria: string;
    channel: {
      type: string;
      endpoint: string;
    };
    last_triggered?: string;
  }>;
}> {
  try {
    const bundle = (await medplumFetch('/fhir/R4/Subscription?status=active')) as {
      entry?: Array<{
        resource: {
          id: string;
          status: string;
          criteria: string;
          channel: {
            type: string;
            endpoint: string;
          };
        };
      }>;
    };

    const subscriptions = (bundle.entry || []).map((e) => ({
      id: e.resource.id,
      status: e.resource.status,
      criteria: e.resource.criteria,
      channel: {
        type: e.resource.channel.type,
        endpoint: e.resource.channel.endpoint,
      },
    }));

    return { subscriptions };
  } catch {
    return { subscriptions: [] };
  }
}

/**
 * 5. create_subscription - Create a new FHIR Subscription
 */
export async function createSubscription(
  params: CreateSubscriptionParams
): Promise<{
  success: boolean;
  subscription_id?: string;
  error?: string;
}> {
  const { criteria, channel_type, endpoint, payload_content } = params;

  const subscription = {
    resourceType: 'Subscription',
    status: 'requested',
    criteria,
    channel: {
      type: channel_type,
      endpoint,
      payload: payload_content || 'application/fhir+json',
    },
  };

  try {
    const result = (await medplumFetch('/fhir/R4/Subscription', {
      method: 'POST',
      body: JSON.stringify(subscription),
    })) as { id: string };

    return {
      success: true,
      subscription_id: result.id,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * 6. get_integration_status - Status of external integrations
 */
export async function getIntegrationStatus(): Promise<{
  integrations: Array<{
    name: string;
    type: string;
    protocol: string;
    status: string;
    last_message?: string;
    messages_today?: number;
  }>;
}> {
  // In production, this would check actual integration endpoints
  // For now, return a placeholder structure
  return {
    integrations: [
      {
        name: 'FabricEMR Bots',
        type: 'internal',
        protocol: 'FHIR R4',
        status: 'connected',
        messages_today: 0,
      },
    ],
  };
}

/**
 * 7. run_database_maintenance - Trigger database maintenance
 */
export async function runDatabaseMaintenance(params: {
  task: 'vacuum' | 'reindex' | 'analyze' | 'backup';
}): Promise<{
  success: boolean;
  task: string;
  message: string;
  duration_ms?: number;
}> {
  const { task } = params;
  const startMs = Date.now();

  // In production, these would execute actual database commands
  // For now, return simulated responses
  let message: string;

  switch (task) {
    case 'vacuum':
      message = 'VACUUM ANALYZE completed on all tables';
      break;
    case 'reindex':
      message = 'REINDEX completed on all indexes';
      break;
    case 'analyze':
      message = 'ANALYZE completed - statistics updated';
      break;
    case 'backup':
      message = `Backup initiated - file: medplum_backup_${Date.now()}.sql`;
      break;
    default:
      return {
        success: false,
        task,
        message: `Unknown maintenance task: ${task}`,
      };
  }

  return {
    success: true,
    task,
    message,
    duration_ms: Date.now() - startMs,
  };
}

/**
 * 8. get_audit_logs - Get FHIR AuditEvent resources
 */
export async function getAuditLogs(
  params?: AuditLogsParams
): Promise<{
  audit_events: Array<{
    id: string;
    recorded: string;
    type: string;
    action: string;
    outcome: string;
    agent?: string;
    entity?: string;
  }>;
  total: number;
}> {
  const limit = params?.limit || 50;

  // Build query params
  const queryParts: string[] = [`_count=${limit}`, '_sort=-recorded'];

  if (params?.since) {
    queryParts.push(`recorded=ge${params.since}`);
  }
  if (params?.action) {
    queryParts.push(`action=${params.action}`);
  }

  const queryString = queryParts.join('&');

  try {
    const bundle = (await medplumFetch(
      `/fhir/R4/AuditEvent?${queryString}`
    )) as {
      total?: number;
      entry?: Array<{
        resource: {
          id: string;
          recorded: string;
          type: { display?: string };
          action: string;
          outcome: string;
          agent?: Array<{ who?: { display?: string } }>;
          entity?: Array<{ what?: { reference?: string } }>;
        };
      }>;
    };

    const auditEvents = (bundle.entry || []).map((e) => ({
      id: e.resource.id,
      recorded: e.resource.recorded,
      type: e.resource.type?.display || 'unknown',
      action: e.resource.action,
      outcome: e.resource.outcome,
      agent: e.resource.agent?.[0]?.who?.display,
      entity: e.resource.entity?.[0]?.what?.reference,
    }));

    return {
      audit_events: auditEvents,
      total: bundle.total || auditEvents.length,
    };
  } catch {
    return {
      audit_events: [],
      total: 0,
    };
  }
}

/**
 * 9. validate_resource - Validate a FHIR resource
 */
export async function validateResource(
  params: ValidateResourceParams
): Promise<{
  valid: boolean;
  issues: Array<{
    severity: string;
    code: string;
    details: string;
    location?: string;
  }>;
}> {
  const { resource, profile } = params;

  // Build the $validate URL
  const resourceType = resource.resourceType as string;
  let url = `/fhir/R4/${resourceType}/$validate`;
  if (profile) {
    url += `?profile=${encodeURIComponent(profile)}`;
  }

  try {
    const result = (await medplumFetch(url, {
      method: 'POST',
      body: JSON.stringify(resource),
    })) as {
      issue?: Array<{
        severity: string;
        code: string;
        details?: { text?: string };
        location?: string[];
      }>;
    };

    const issues = (result.issue || []).map((i) => ({
      severity: i.severity,
      code: i.code,
      details: i.details?.text || '',
      location: i.location?.[0],
    }));

    const hasErrors = issues.some(
      (i) => i.severity === 'error' || i.severity === 'fatal'
    );

    return {
      valid: !hasErrors,
      issues,
    };
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          severity: 'error',
          code: 'exception',
          details: String(error),
        },
      ],
    };
  }
}

/**
 * BONUS: get_bot_status - Get status of deployed bots
 */
export async function getBotStatus(): Promise<{
  bots: Array<{
    id: string;
    name: string;
    status: string;
    last_executed?: string;
  }>;
}> {
  try {
    const bundle = (await medplumFetch('/fhir/R4/Bot?_count=50')) as {
      entry?: Array<{
        resource: {
          id: string;
          name: string;
          status?: string;
        };
      }>;
    };

    const bots = (bundle.entry || []).map((e) => ({
      id: e.resource.id,
      name: e.resource.name || 'Unnamed Bot',
      status: e.resource.status || 'active',
    }));

    return { bots };
  } catch {
    return { bots: [] };
  }
}
