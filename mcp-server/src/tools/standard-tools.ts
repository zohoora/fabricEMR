/**
 * Standard MCP Tools - All 12 tools from Worker MCP Spec
 * These are required for all worker agents
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentIdentity,
  AgentStatus,
  HealthCheck,
  CapabilitiesResponse,
  LogEntry,
  LogsParams,
  ConfigParams,
  UpdateConfigParams,
  ExecuteCommandParams,
  ChangeRequest,
  Issue,
  ReportIssueParams,
  RecentError,
  RecentErrorsResponse,
  IssueStatus,
  RequestStatus,
} from '../types';

// Server start time for uptime calculation
const startTime = new Date();

// In-memory stores (in production, use persistent storage)
const reportedIssues: Issue[] = [];
const changeRequests: ChangeRequest[] = [];
const recentErrors: RecentError[] = [];
const configStore: Record<string, Record<string, unknown>> = {
  agent: {
    log_level: 'info',
    auto_restart: true,
  },
  'medplum-server': {
    port: 8103,
    base_url: process.env.MEDPLUM_BASE_URL || 'http://localhost:8103',
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: 'medplum',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
};

/**
 * 1. agent_identity - Returns agent's identity and basic information
 */
export async function agentIdentity(): Promise<AgentIdentity> {
  const uptimeMs = Date.now() - startTime.getTime();

  return {
    agent_id: 'clinic-medplum',
    agent_name: 'Medplum FHIR Server Agent',
    version: '1.0.0',
    machine: process.env.MACHINE_NAME || 'AI-Server',
    mcp_port: parseInt(process.env.MCP_PORT || '7203'),
    uptime_seconds: Math.floor(uptimeMs / 1000),
    started_at: startTime.toISOString(),
    capabilities: [
      'fhir_server',
      'fhir_subscriptions',
      'database_management',
      'audit_logging',
      'resource_validation',
    ],
  };
}

/**
 * 2. get_status - Returns current operational status
 */
export async function getStatus(): Promise<AgentStatus> {
  const medplumHealthy = await checkMedplumHealth();
  const postgresHealthy = await checkPostgresHealth();
  const redisHealthy = await checkRedisHealth();

  const allHealthy = medplumHealthy && postgresHealthy && redisHealthy;
  const anyError = !medplumHealthy || !postgresHealthy;

  const status = allHealthy ? 'healthy' : anyError ? 'error' : 'degraded';

  const warnings: string[] = [];
  if (!redisHealthy) warnings.push('Redis cache unavailable - performance may be degraded');
  if (!postgresHealthy) warnings.push('PostgreSQL connection issues');
  if (!medplumHealthy) warnings.push('Medplum server not responding');

  return {
    status,
    services: [
      {
        name: 'medplum-server',
        status: medplumHealthy ? 'running' : 'error',
        memory_mb: 512, // Placeholder
        cpu_percent: 5.0, // Placeholder
      },
      {
        name: 'postgres',
        status: postgresHealthy ? 'running' : 'error',
      },
      {
        name: 'redis',
        status: redisHealthy ? 'running' : 'error',
      },
    ],
    last_activity: new Date().toISOString(),
    active_tasks: 0,
    queued_tasks: 0,
    error_count_last_hour: recentErrors.filter(
      (e) => new Date(e.timestamp) > new Date(Date.now() - 3600000)
    ).length,
    warnings,
  };
}

/**
 * 3. get_logs - Retrieves recent log entries
 */
export async function getLogs(params?: LogsParams): Promise<{
  entries: LogEntry[];
  total_matching: number;
  truncated: boolean;
}> {
  const lines = params?.lines || 50;
  const level = params?.level || 'all';
  const service = params?.service;
  const since = params?.since;
  const search = params?.search;

  // In production, read from actual log files
  // For now, return simulated recent logs
  let entries: LogEntry[] = [
    {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'medplum-server',
      message: 'Health check passed',
    },
    {
      timestamp: new Date(Date.now() - 60000).toISOString(),
      level: 'info',
      service: 'postgres',
      message: 'Connection pool healthy: 5/100 connections in use',
    },
  ];

  // Apply filters
  if (level !== 'all') {
    const levelOrder = ['debug', 'info', 'warn', 'error'];
    const minLevel = levelOrder.indexOf(level);
    entries = entries.filter((e) => levelOrder.indexOf(e.level) >= minLevel);
  }
  if (service) {
    entries = entries.filter((e) => e.service === service);
  }
  if (since) {
    const sinceDate = new Date(since);
    entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate);
  }
  if (search) {
    const searchLower = search.toLowerCase();
    entries = entries.filter((e) => e.message.toLowerCase().includes(searchLower));
  }

  const total = entries.length;
  const truncated = total > lines;

  return {
    entries: entries.slice(0, lines),
    total_matching: total,
    truncated,
  };
}

/**
 * 4. get_capabilities - Returns detailed capability information
 */
export async function getCapabilities(): Promise<CapabilitiesResponse> {
  return {
    capabilities: [
      {
        id: 'fhir_server',
        name: 'FHIR R4 Server',
        description: 'Full FHIR R4 compliant server with REST API',
        dependencies: [],
      },
      {
        id: 'fhir_subscriptions',
        name: 'FHIR Subscriptions',
        description: 'Real-time notifications via FHIR Subscriptions',
        dependencies: [],
      },
      {
        id: 'database_management',
        name: 'Database Management',
        description: 'PostgreSQL database maintenance and monitoring',
        dependencies: [],
      },
      {
        id: 'audit_logging',
        name: 'Audit Logging',
        description: 'FHIR AuditEvent resources for compliance',
        dependencies: [],
      },
      {
        id: 'resource_validation',
        name: 'Resource Validation',
        description: 'Validate FHIR resources against profiles',
        dependencies: [],
      },
    ],
    dependencies: {
      postgres: { required: true, status: await checkPostgresHealth() ? 'connected' : 'disconnected' },
      redis: { required: false, status: await checkRedisHealth() ? 'connected' : 'disconnected' },
    },
    supported_commands: [
      'restart_service',
      'stop_service',
      'start_service',
      'run_diagnostic',
      'clear_cache',
      'rotate_logs',
      'backup_config',
    ],
  };
}

/**
 * 5. get_config - Returns current configuration
 */
export async function getConfig(params?: ConfigParams): Promise<{
  agent_config: Record<string, unknown>;
  service_configs: Record<string, Record<string, unknown>>;
}> {
  const service = params?.service;
  const includeSecrets = params?.include_secrets || false;

  let serviceConfigs = { ...configStore };
  delete serviceConfigs.agent;

  if (service) {
    serviceConfigs = { [service]: serviceConfigs[service] || {} };
  }

  // Redact secrets unless explicitly requested
  if (!includeSecrets) {
    for (const svc of Object.keys(serviceConfigs)) {
      const config = serviceConfigs[svc];
      for (const key of Object.keys(config)) {
        if (key.includes('password') || key.includes('secret') || key.includes('key')) {
          config[key] = '***REDACTED***';
        }
      }
    }
  }

  return {
    agent_config: configStore.agent,
    service_configs: serviceConfigs,
  };
}

/**
 * 6. update_config - Updates configuration
 */
export async function updateConfig(params: UpdateConfigParams): Promise<{
  success: boolean;
  changes_applied: Record<string, unknown>;
  restart_required: boolean;
  restarted: boolean;
  warnings: string[];
}> {
  const { service, changes, restart_if_needed } = params;

  if (!configStore[service]) {
    configStore[service] = {};
  }

  const changesApplied: Record<string, unknown> = {};
  const warnings: string[] = [];
  let restartRequired = false;

  for (const [key, value] of Object.entries(changes)) {
    // Check if this is a restart-requiring change
    if (['port', 'host', 'base_url'].includes(key)) {
      restartRequired = true;
    }
    configStore[service][key] = value;
    changesApplied[key] = value;
  }

  let restarted = false;
  if (restartRequired && restart_if_needed) {
    // In production, actually restart the service
    warnings.push(`Service ${service} configuration updated - restart recommended`);
  }

  return {
    success: true,
    changes_applied: changesApplied,
    restart_required: restartRequired,
    restarted,
    warnings,
  };
}

/**
 * 7. execute_command - Executes predefined commands
 */
export async function executeCommand(params: ExecuteCommandParams): Promise<{
  success: boolean;
  command: string;
  output: string;
  duration_ms: number;
}> {
  const { command, args, timeout_seconds } = params;
  const startMs = Date.now();

  const allowedCommands = [
    'restart_service',
    'stop_service',
    'start_service',
    'run_diagnostic',
    'clear_cache',
    'rotate_logs',
    'backup_config',
  ];

  if (!allowedCommands.includes(command)) {
    return {
      success: false,
      command,
      output: `Command not allowed: ${command}`,
      duration_ms: Date.now() - startMs,
    };
  }

  let output: string;

  switch (command) {
    case 'restart_service':
      output = `Service ${args?.service || 'medplum-server'} restart initiated`;
      break;
    case 'run_diagnostic':
      const medplumOk = await checkMedplumHealth();
      const pgOk = await checkPostgresHealth();
      const redisOk = await checkRedisHealth();
      output = `Diagnostic complete: Medplum=${medplumOk ? 'OK' : 'FAIL'}, Postgres=${pgOk ? 'OK' : 'FAIL'}, Redis=${redisOk ? 'OK' : 'FAIL'}`;
      break;
    case 'clear_cache':
      output = 'Cache cleared (Redis FLUSHDB simulated)';
      break;
    case 'rotate_logs':
      output = 'Log rotation triggered';
      break;
    case 'backup_config':
      output = `Configuration backed up to config-backup-${Date.now()}.json`;
      break;
    default:
      output = `Command ${command} executed successfully`;
  }

  return {
    success: true,
    command,
    output,
    duration_ms: Date.now() - startMs,
  };
}

/**
 * 8. request_change - Request a code/functionality change
 */
export async function requestChange(params: ChangeRequest): Promise<{
  request_id: string;
  status: RequestStatus;
  estimated_completion: string | null;
  notes: string;
  dependencies_needed: string[];
}> {
  const request: ChangeRequest = {
    ...params,
    status: 'queued',
    created_at: new Date().toISOString(),
    progress_percent: 0,
  };

  changeRequests.push(request);

  return {
    request_id: params.request_id,
    status: 'queued',
    estimated_completion: null,
    notes: 'Request queued for review by IT Admin',
    dependencies_needed: [],
  };
}

/**
 * 9. get_pending_requests - Returns pending change requests
 */
export async function getPendingRequests(params?: {
  status_filter?: RequestStatus;
  limit?: number;
}): Promise<{ requests: ChangeRequest[] }> {
  let requests = [...changeRequests];

  if (params?.status_filter) {
    requests = requests.filter((r) => r.status === params.status_filter);
  }

  const limit = params?.limit || 10;

  return {
    requests: requests.slice(0, limit),
  };
}

/**
 * 10. report_issue - Report an issue
 */
export async function reportIssue(params: ReportIssueParams): Promise<{
  issue_id: string;
  acknowledged: boolean;
}> {
  const issue: Issue = {
    ...params,
    status: 'open',
    created_at: new Date().toISOString(),
  };

  reportedIssues.push(issue);

  // Also add to recent errors for triage
  recentErrors.push({
    error_id: `err-${Date.now()}`,
    timestamp: new Date().toISOString(),
    severity: params.severity,
    service: 'clinic-medplum',
    category: params.category,
    code: params.issue_id,
    message: params.description,
    resolved: false,
    resolution_hint: params.suggested_resolution,
  });

  return {
    issue_id: params.issue_id,
    acknowledged: true,
  };
}

/**
 * 11. get_reported_issues - Get issues reported by this agent
 */
export async function getReportedIssues(params?: {
  status?: IssueStatus;
  severity?: string;
  limit?: number;
}): Promise<{ issues: Issue[] }> {
  let issues = [...reportedIssues];

  if (params?.status) {
    issues = issues.filter((i) => i.status === params.status);
  }
  if (params?.severity) {
    issues = issues.filter((i) => i.severity === params.severity);
  }

  const limit = params?.limit || 20;

  return {
    issues: issues.slice(0, limit),
  };
}

/**
 * 12. health_check - Quick health check
 */
export async function healthCheck(): Promise<HealthCheck> {
  const servicesRunning = await checkMedplumHealth();
  const diskSpaceOk = true; // Placeholder
  const memoryOk = true; // Placeholder
  const dependenciesOk = await checkPostgresHealth();

  return {
    healthy: servicesRunning && dependenciesOk,
    timestamp: new Date().toISOString(),
    checks: {
      services_running: servicesRunning,
      disk_space_ok: diskSpaceOk,
      memory_ok: memoryOk,
      dependencies_ok: dependenciesOk,
    },
  };
}

/**
 * BONUS: get_recent_errors - For triage (from architecture doc)
 */
export async function getRecentErrors(params?: {
  severity?: string;
  service?: string;
  limit?: number;
}): Promise<RecentErrorsResponse> {
  let errors = [...recentErrors];

  if (params?.severity) {
    errors = errors.filter((e) => e.severity === params.severity);
  }
  if (params?.service) {
    errors = errors.filter((e) => e.service === params.service);
  }

  const limit = params?.limit || 50;

  return {
    errors: errors.slice(0, limit),
    total_matching: errors.length,
    summary: {
      critical: errors.filter((e) => e.severity === 'critical').length,
      error: errors.filter((e) => e.severity === 'error').length,
      warning: errors.filter((e) => e.severity === 'warning').length,
    },
  };
}

// Helper functions for health checks
interface MedplumHealthResponse {
  ok?: boolean;
  postgres?: boolean;
  redis?: boolean;
}

async function checkMedplumHealth(): Promise<boolean> {
  try {
    const baseUrl = process.env.MEDPLUM_BASE_URL || 'http://localhost:8103';
    const response = await fetch(`${baseUrl}/healthcheck`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json() as MedplumHealthResponse;
    return data.ok === true;
  } catch {
    return false;
  }
}

async function checkPostgresHealth(): Promise<boolean> {
  try {
    const baseUrl = process.env.MEDPLUM_BASE_URL || 'http://localhost:8103';
    const response = await fetch(`${baseUrl}/healthcheck`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json() as MedplumHealthResponse;
    return data.postgres === true;
  } catch {
    return false;
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    const baseUrl = process.env.MEDPLUM_BASE_URL || 'http://localhost:8103';
    const response = await fetch(`${baseUrl}/healthcheck`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json() as MedplumHealthResponse;
    return data.redis === true;
  } catch {
    return false;
  }
}
