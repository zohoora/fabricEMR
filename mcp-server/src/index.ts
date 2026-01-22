/**
 * clinic-medplum MCP Server
 *
 * MCP (Model Context Protocol) server for IT Admin coordination.
 * Implements the standard 12 MCP tools plus Medplum-specific tools.
 *
 * Default port: 7203
 */

import express, { Request, Response } from 'express';
import { MCP_TOOLS, TOOL_DESCRIPTIONS } from './tools';
import type { MCPRequest, MCPResponse, MCPError } from './types';

const app = express();
app.use(express.json());

// Configuration
const PORT = parseInt(process.env.MCP_PORT || '7203');
const AGENT_ID = 'clinic-medplum';
const AGENT_NAME = 'Medplum FHIR Server Agent';
const VERSION = '1.0.0';

// JSON-RPC response helpers
function makeResponse(id: string | number | null, result: unknown): MCPResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(
  id: string | number | null,
  code: number,
  message: string
): MCPResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// Standard JSON-RPC error codes
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * POST /mcp/message - Main JSON-RPC 2.0 endpoint
 */
app.post('/mcp/message', async (req: Request, res: Response) => {
  const mcpRequest = req.body as MCPRequest;

  // Validate JSON-RPC format
  if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
    res.json(makeError(null, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC version'));
    return;
  }

  const { method, params, id } = mcpRequest;

  // Handle MCP protocol methods
  if (method === 'initialize') {
    res.json(
      makeResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: AGENT_ID, version: VERSION },
      })
    );
    return;
  }

  if (method === 'tools/list') {
    const result = await MCP_TOOLS.list_tools(undefined);
    res.json(makeResponse(id, result));
    return;
  }

  if (method === 'tools/call') {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs = (params as Record<string, unknown>)?.arguments as
      | Record<string, unknown>
      | undefined;

    if (!toolName) {
      res.json(makeError(id, ERROR_CODES.INVALID_PARAMS, 'Missing tool name'));
      return;
    }

    if (MCP_TOOLS[toolName]) {
      try {
        const result = await MCP_TOOLS[toolName](toolArgs);
        res.json(
          makeResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          })
        );
      } catch (error) {
        res.json(makeError(id, ERROR_CODES.INTERNAL_ERROR, String(error)));
      }
    } else {
      res.json(makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Unknown tool: ${toolName}`));
    }
    return;
  }

  // Handle direct tool calls (tools/<tool_name> shortcut)
  if (method.startsWith('tools/')) {
    const toolName = method.split('/')[1];
    if (MCP_TOOLS[toolName]) {
      try {
        const result = await MCP_TOOLS[toolName](params as Record<string, unknown>);
        res.json(makeResponse(id, result));
      } catch (error) {
        res.json(makeError(id, ERROR_CODES.INTERNAL_ERROR, String(error)));
      }
    } else {
      res.json(makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Unknown tool: ${toolName}`));
    }
    return;
  }

  res.json(makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`));
});

/**
 * GET /mcp/sse - Server-Sent Events for real-time updates
 */
app.get('/mcp/sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection event
  res.write(
    `data: ${JSON.stringify({ type: 'connected', agent_id: AGENT_ID })}\n\n`
  );

  // Send heartbeat every 30 seconds
  const heartbeatInterval = setInterval(() => {
    res.write(
      `data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
      })}\n\n`
    );
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
  });
});

/**
 * GET /mcp/info - Quick info endpoint for debugging
 */
app.get('/mcp/info', async (req: Request, res: Response) => {
  res.json({
    agent: {
      agent_id: AGENT_ID,
      agent_name: AGENT_NAME,
      version: VERSION,
      machine: process.env.MACHINE_NAME || 'AI-Server',
      mcp_port: PORT,
      capabilities: [
        'fhir_server',
        'fhir_subscriptions',
        'database_management',
        'audit_logging',
        'resource_validation',
      ],
    },
    endpoints: {
      message: '/mcp/message',
      sse: '/mcp/sse',
      info: '/mcp/info',
    },
    tools: Object.keys(MCP_TOOLS).filter((t) => t !== 'list_tools'),
  });
});

/**
 * GET /health - Simple health check (non-MCP)
 */
app.get('/health', async (req: Request, res: Response) => {
  try {
    const healthResult = await MCP_TOOLS.health_check(undefined);
    res.json(healthResult);
  } catch {
    res.status(503).json({ healthy: false, error: 'Health check failed' });
  }
});

/**
 * GET / - Root endpoint with server info
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: AGENT_NAME,
    agent_id: AGENT_ID,
    version: VERSION,
    mcp_port: PORT,
    status: 'running',
    endpoints: {
      mcp_message: `http://localhost:${PORT}/mcp/message`,
      mcp_sse: `http://localhost:${PORT}/mcp/sse`,
      mcp_info: `http://localhost:${PORT}/mcp/info`,
      health: `http://localhost:${PORT}/health`,
    },
    documentation: 'Use POST /mcp/message with JSON-RPC 2.0 format',
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           clinic-medplum MCP Server v${VERSION}                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Agent ID:    ${AGENT_ID.padEnd(45)}║
║  MCP Port:    ${String(PORT).padEnd(45)}║
║  Medplum:     ${(process.env.MEDPLUM_BASE_URL || 'http://localhost:8103').padEnd(45)}║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    POST /mcp/message  - JSON-RPC 2.0 tool calls               ║
║    GET  /mcp/sse      - Server-Sent Events                    ║
║    GET  /mcp/info     - Quick info                            ║
║    GET  /health       - Health check                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Tools Available: ${String(Object.keys(MCP_TOOLS).length).padEnd(42)}║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
