/**
 * MCP Server Types for clinic-medplum agent
 */

// JSON-RPC 2.0 types
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// Agent identity
export interface AgentIdentity {
  agent_id: string;
  agent_name: string;
  version: string;
  machine: string;
  mcp_port: number;
  uptime_seconds: number;
  started_at: string;
  capabilities: string[];
}

// Status types
export type StatusLevel = 'healthy' | 'degraded' | 'error' | 'offline';
export type SeverityLevel = 'info' | 'warning' | 'error' | 'critical';
export type IssueCategory = 'dependency' | 'resource' | 'bug' | 'security';
export type RequestType = 'feature' | 'bugfix' | 'config' | 'refactor';
export type RequestStatus = 'accepted' | 'queued' | 'in_progress' | 'needs_info' | 'rejected';
export type IssueStatus = 'open' | 'acknowledged' | 'resolved';

// Service status
export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  pid?: number;
  memory_mb?: number;
  cpu_percent?: number;
}

export interface AgentStatus {
  status: StatusLevel;
  services: ServiceStatus[];
  last_activity: string;
  active_tasks: number;
  queued_tasks: number;
  error_count_last_hour: number;
  warnings: string[];
}

// Health check
export interface HealthCheck {
  healthy: boolean;
  timestamp: string;
  checks: {
    services_running: boolean;
    disk_space_ok: boolean;
    memory_ok: boolean;
    dependencies_ok: boolean;
  };
}

// Capability
export interface Capability {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  config_options?: string[];
}

export interface CapabilitiesResponse {
  capabilities: Capability[];
  dependencies: Record<string, { required: boolean; status: string }>;
  supported_commands: string[];
}

// Logs
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
}

export interface LogsParams {
  lines?: number;
  level?: 'all' | 'error' | 'warn' | 'info' | 'debug';
  service?: string;
  since?: string;
  search?: string;
}

// Config
export interface ConfigParams {
  service?: string;
  include_secrets?: boolean;
}

export interface UpdateConfigParams {
  service: string;
  changes: Record<string, unknown>;
  restart_if_needed?: boolean;
}

// Commands
export type CommandName =
  | 'restart_service'
  | 'stop_service'
  | 'start_service'
  | 'run_diagnostic'
  | 'clear_cache'
  | 'rotate_logs'
  | 'backup_config';

export interface ExecuteCommandParams {
  command: CommandName;
  args?: Record<string, unknown>;
  timeout_seconds?: number;
}

// Issues
export interface Issue {
  issue_id: string;
  severity: SeverityLevel;
  category: IssueCategory;
  title: string;
  description: string;
  affected_capabilities: string[];
  suggested_resolution: string;
  related_agents: string[];
  status?: IssueStatus;
  created_at?: string;
}

export interface ReportIssueParams extends Omit<Issue, 'status' | 'created_at'> {}

// Change requests
export interface ChangeRequest {
  request_id: string;
  type: RequestType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details?: string;
  requested_by: string;
  related_agents?: string[];
  context?: Record<string, unknown>;
  status?: RequestStatus;
  created_at?: string;
  progress_percent?: number;
}

// Medplum-specific types
export interface MedplumServerStatus {
  server: {
    version: string;
    status: string;
    uptime_hours: number;
    base_url: string;
  };
  database: {
    status: string;
    size_gb: number;
    connections_active: number;
    connections_max: number;
  };
  redis: {
    status: string;
    memory_used_mb: number;
    hit_rate: number;
  };
  resources: Record<string, number>;
}

export interface ResourceCountsParams {
  resource_types?: string[];
  since?: string;
}

export interface SearchResourcesParams {
  resource_type: string;
  search_params: Record<string, string>;
  limit?: number;
}

export interface CreateSubscriptionParams {
  criteria: string;
  channel_type: 'rest-hook' | 'websocket';
  endpoint: string;
  payload_content?: 'empty' | 'id-only' | 'full-resource';
}

export interface AuditLogsParams {
  agent?: string;
  action?: string;
  resource_type?: string;
  since?: string;
  limit?: number;
}

export interface ValidateResourceParams {
  resource: Record<string, unknown>;
  profile?: string;
}

// Recent errors (for triage)
export interface RecentError {
  error_id: string;
  timestamp: string;
  severity: SeverityLevel;
  service: string;
  category: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  resolved: boolean;
  resolution_hint?: string;
}

export interface RecentErrorsResponse {
  errors: RecentError[];
  total_matching: number;
  summary: {
    critical: number;
    error: number;
    warning: number;
  };
}

// Tool handler type
export type ToolHandler = (
  params: Record<string, unknown> | undefined
) => Promise<unknown>;
