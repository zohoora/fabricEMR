/**
 * MCP Tools Index
 * Exports all tools and the tool registry
 */

import type { ToolHandler } from '../types';

// Standard MCP tools (12 required tools)
import {
  agentIdentity,
  getStatus,
  getLogs,
  getCapabilities,
  getConfig,
  updateConfig,
  executeCommand,
  requestChange,
  getPendingRequests,
  reportIssue,
  getReportedIssues,
  healthCheck,
  getRecentErrors,
} from './standard-tools';

// Medplum-specific tools
import {
  getServerStatus,
  getResourceCounts,
  searchResources,
  getSubscriptions,
  createSubscription,
  getIntegrationStatus,
  runDatabaseMaintenance,
  getAuditLogs,
  validateResource,
  getBotStatus,
} from './medplum-tools';

// Tool registry with all available tools
export const MCP_TOOLS: Record<string, ToolHandler> = {
  // Standard MCP tools (12)
  agent_identity: async () => agentIdentity(),
  get_status: async () => getStatus(),
  get_logs: async (params) => getLogs(params as Parameters<typeof getLogs>[0]),
  get_capabilities: async () => getCapabilities(),
  get_config: async (params) => getConfig(params as Parameters<typeof getConfig>[0]),
  update_config: async (params) => {
    if (!params) throw new Error('update_config requires params');
    return updateConfig(params as unknown as Parameters<typeof updateConfig>[0]);
  },
  execute_command: async (params) => {
    if (!params) throw new Error('execute_command requires params');
    return executeCommand(params as unknown as Parameters<typeof executeCommand>[0]);
  },
  request_change: async (params) => {
    if (!params) throw new Error('request_change requires params');
    return requestChange(params as unknown as Parameters<typeof requestChange>[0]);
  },
  get_pending_requests: async (params) =>
    getPendingRequests(params as Parameters<typeof getPendingRequests>[0]),
  report_issue: async (params) => {
    if (!params) throw new Error('report_issue requires params');
    return reportIssue(params as Parameters<typeof reportIssue>[0]);
  },
  get_reported_issues: async (params) =>
    getReportedIssues(params as Parameters<typeof getReportedIssues>[0]),
  health_check: async () => healthCheck(),

  // Bonus: get_recent_errors for triage
  get_recent_errors: async (params) =>
    getRecentErrors(params as Parameters<typeof getRecentErrors>[0]),

  // Medplum-specific tools (9+1)
  get_server_status: async () => getServerStatus(),
  get_resource_counts: async (params) =>
    getResourceCounts(params as Parameters<typeof getResourceCounts>[0]),
  search_resources: async (params) => {
    if (!params) throw new Error('search_resources requires params');
    return searchResources(params as unknown as Parameters<typeof searchResources>[0]);
  },
  get_subscriptions: async () => getSubscriptions(),
  create_subscription: async (params) => {
    if (!params) throw new Error('create_subscription requires params');
    return createSubscription(params as unknown as Parameters<typeof createSubscription>[0]);
  },
  get_integration_status: async () => getIntegrationStatus(),
  run_database_maintenance: async (params) => {
    if (!params) throw new Error('run_database_maintenance requires params');
    return runDatabaseMaintenance(
      params as Parameters<typeof runDatabaseMaintenance>[0]
    );
  },
  get_audit_logs: async (params) =>
    getAuditLogs(params as Parameters<typeof getAuditLogs>[0]),
  validate_resource: async (params) => {
    if (!params) throw new Error('validate_resource requires params');
    return validateResource(params as unknown as Parameters<typeof validateResource>[0]);
  },
  get_bot_status: async () => getBotStatus(),

  // Meta tool
  list_tools: async () => ({
    tools: Object.keys(MCP_TOOLS)
      .filter((name) => name !== 'list_tools')
      .map((name) => ({
        name,
        description: TOOL_DESCRIPTIONS[name] || 'No description available',
      })),
  }),
};

// Tool descriptions for list_tools
const TOOL_DESCRIPTIONS: Record<string, string> = {
  // Standard tools
  agent_identity: 'Get agent identity information',
  get_status: 'Get current operational status',
  get_logs: 'Retrieve recent log entries',
  get_capabilities: 'Get detailed capability information',
  get_config: 'Get current configuration',
  update_config: 'Update configuration',
  execute_command: 'Execute predefined commands',
  request_change: 'Request a code/functionality change',
  get_pending_requests: 'Get pending change requests',
  report_issue: 'Report an issue',
  get_reported_issues: 'Get reported issues',
  health_check: 'Quick health check',
  get_recent_errors: 'Get recent errors for triage',

  // Medplum-specific tools
  get_server_status: 'Get detailed Medplum server status',
  get_resource_counts: 'Get FHIR resource counts by type',
  search_resources: 'Search FHIR resources',
  get_subscriptions: 'Get active FHIR Subscriptions',
  create_subscription: 'Create a new FHIR Subscription',
  get_integration_status: 'Get status of external integrations',
  run_database_maintenance: 'Run database maintenance tasks',
  get_audit_logs: 'Get FHIR AuditEvent resources',
  validate_resource: 'Validate a FHIR resource against profiles',
  get_bot_status: 'Get status of deployed bots',
};

export { TOOL_DESCRIPTIONS };
