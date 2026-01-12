# Medplum AI Bots

AI-native extensions for Medplum that provide semantic search, clinical decision support, and AI-assisted clinical documentation.

## Deployment Status

All 9 bots are **deployed and running** in Medplum. See [Deployed Bots](#deployed-bots) for IDs.

## Overview

This package contains a suite of Medplum bots that integrate LLMs via an OpenAI-compatible LLM Router to provide intelligent healthcare automation while maintaining patient safety and regulatory compliance.

### Key Features

- **Semantic Search**: Vector-based clinical document search using pgvector
- **RAG Pipeline**: Retrieval-Augmented Generation for clinical Q&A
- **Clinical Decision Support**: AI-powered analysis with safety guardrails
- **Documentation Assistant**: Auto-generate clinical notes from patient data
- **Billing Code Suggester**: AI-assisted CPT/ICD-10 code recommendations
- **Command-Based Writes**: Human-in-the-loop approval for AI suggestions
- **Comprehensive Audit Trail**: Full provenance tracking for AI actions

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Medplum AI Bots Stack                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Embedding Bot  │  │ Semantic Search │  │  RAG Pipeline   │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│  ┌────────┴────────────────────┴────────────────────┴────────┐ │
│  │              Shared LLM Client (services/llm-client.ts)    │ │
│  │  OpenAI-compatible API: /v1/chat/completions, /v1/embeddings│ │
│  └────────┬────────────────────┬────────────────────┬────────┘ │
│           │                    │                    │          │
│  ┌────────┴────────┐  ┌───────┴───────┐  ┌────────┴────────┐  │
│  │ Approval Queue  │  │ Audit Logger  │  │ Safety Filters  │  │
│  └─────────────────┘  └───────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      External Services                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ LLM Router      │  │   PostgreSQL    │  │ Medplum Server  │ │
│  │ (OpenAI API)    │  │   + pgvector    │  │                 │ │
│  │ → Ollama/etc    │  │   (768-dim)     │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Deployed Bots

All bots are deployed in the Medplum Super Admin project:

| Bot | Medplum ID | Trigger Type |
|-----|------------|--------------|
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` | Subscription (auto) |
| Semantic Search Bot | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | API ($execute) |
| RAG Pipeline Bot | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | API ($execute) |
| Command Processor Bot | `87780e52-abc5-4122-8225-07e74aaf18ca` | API ($execute) |
| Approval Queue Bot | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Subscription (auto) |
| Clinical Decision Support Bot | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | Subscription (auto) |
| Documentation Assistant Bot | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | API ($execute) |
| Billing Code Suggester Bot | `093a0c9d-44ea-4672-8208-d1d199962f33` | Subscription (auto) |
| Audit Logging Bot | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | API ($execute) |

### Invoking API Bots

```bash
# Execute a bot via API
curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"resourceType": "Parameters", "parameter": [{"name": "input", "valueString": "..."}]}'
```

## Prerequisites

- Node.js 18+
- Docker with Docker Desktop (macOS) or Docker Engine (Linux)
- Medplum server running locally
- LLM Router with OpenAI-compatible API (routes to backend models):
  - Model alias `clinical-model` (e.g., qwen3:4b) for text generation
  - Model alias `embedding-model` (e.g., nomic-embed-text) for 768-dim embeddings

## Installation

```bash
# Clone and navigate to bots directory
cd ~/medplum/bots

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Configuration

### Environment Variables

```bash
# Medplum connection
MEDPLUM_BASE_URL=http://localhost:8103
MEDPLUM_CLIENT_ID=your-client-id
MEDPLUM_CLIENT_SECRET=your-client-secret

# LLM Router (OpenAI-compatible API) - Primary
LLM_ROUTER_URL=http://127.0.0.1:8080    # RouterLLM endpoint
LLM_API_KEY=fabric-emr-key              # Authentication key
LLM_CLIENT_ID=fabric-emr                # Client identifier

# Model Aliases (configured in LLM Router)
CLINICAL_MODEL=clinical-model        # For text generation
FAST_MODEL=fast-model                # For quick responses
EMBEDDING_MODEL=embedding-model      # For embeddings (768-dim)

# Legacy fallback (if LLM_ROUTER_URL not set)
OLLAMA_API_BASE=http://localhost:11434
```

### Required Headers for LLM Router

All requests to the LLM Router must include:

| Header | Value | Description |
|--------|-------|-------------|
| `Authorization` | `Bearer fabric-emr-key` | API authentication |
| `X-Client-Id` | `fabric-emr` | Client identifier |
| `X-Clinic-Task` | `<task_name>` | Task type (see below) |
| `Content-Type` | `application/json` | Request format |

### Available Tasks

| Task | Use Case |
|------|----------|
| `embedding` | Generate text embeddings for RAG/search |
| `semantic_search` | Semantic similarity queries |
| `rag_query` | RAG-based question answering |
| `clinical_decision` | Clinical decision support |
| `documentation` | Documentation generation |
| `billing_codes` | Billing code suggestions |
| `health_check` | Health check endpoint |

### Safety Filters Configuration

Edit `src/config/safety-filters.json` to customize:
- Confidence thresholds
- Blocked operations
- Approval requirements
- Dual-approval actions

## Bots

### Embedding Bot (`embedding-bot.ts`)

Creates vector embeddings for FHIR resources.

**Trigger**: Subscription on resource create/update
**Supported Resources**: DiagnosticReport, Observation, Condition, DocumentReference

```typescript
// Example: Embedding created for a Condition
{
  type: 'clinical_embedding',
  fhir_resource_type: 'Condition',
  fhir_resource_id: 'condition-123',
  embedding: [0.123, -0.456, ...], // 768 dimensions
  content_text: 'Essential hypertension...'
}
```

### Semantic Search Bot (`semantic-search-bot.ts`)

Performs vector similarity search across clinical data.

**Input**:
```typescript
{
  query: "patient with uncontrolled diabetes",
  patientId?: "patient-123",  // optional filter
  resourceTypes?: ["Condition", "Observation"],
  limit?: 10,
  minSimilarity?: 0.7
}
```

**Output**:
```typescript
{
  success: true,
  results: [
    {
      resourceType: "Condition",
      resourceId: "condition-456",
      similarity: 0.89,
      matchedText: "Type 2 diabetes mellitus..."
    }
  ]
}
```

### RAG Pipeline Bot (`rag-pipeline-bot.ts`)

Answers clinical questions using retrieved context.

**Input**:
```typescript
{
  question: "What is this patient's HbA1c trend?",
  patientId: "patient-123",
  maxContextChunks?: 5
}
```

**Output**:
```typescript
{
  success: true,
  answer: "The patient's HbA1c has improved from 8.2% to 7.1%...",
  confidence: 0.87,
  contextUsed: [...],
  citations: [...]
}
```

### Command Processor Bot (`command-processor-bot.ts`)

Validates and routes AI commands with safety checks.

**Supported Commands**:
- `FlagAbnormalResult` - Flag critical lab values
- `CreateEncounterNoteDraft` - Generate clinical notes
- `ProposeProblemListUpdate` - Suggest diagnosis changes
- `SuggestBillingCodes` - Recommend CPT/ICD-10 codes
- `QueueReferralLetter` - Draft referral letters
- `SuggestMedicationChange` - Propose medication adjustments

### Approval Queue Bot (`approval-queue-bot.ts`)

Handles human-in-the-loop approval workflow.

**Task Statuses**:
- `requested` - Pending approval
- `completed` - Approved and executed
- `rejected` - Denied by clinician
- `failed` - Expired or errored

### Clinical Decision Support Bot (`clinical-decision-support-bot.ts`)

Analyzes patient data for clinical insights.

**Analysis Types**:
- `diagnosis` - Differential diagnosis suggestions
- `interactions` - Drug-drug interaction checks
- `preventive` - Care gap identification
- `critical` - Critical value flagging

### Documentation Assistant Bot (`documentation-assistant-bot.ts`)

Generates clinical documentation.

**Document Types**:
- `progress` - Progress notes (SOAP format)
- `discharge` - Discharge summaries
- `consultation` - Consultation notes
- `referral` - Referral letters
- `history_physical` - H&P documentation

### Billing Code Suggester Bot (`billing-code-suggester-bot.ts`)

Suggests appropriate billing codes.

**Output**:
- CPT codes with rationale
- ICD-10 diagnosis codes
- Modifier suggestions
- Medical necessity linkage
- Documentation gap alerts

### Audit Logging Bot (`audit-logging-bot.ts`)

Creates comprehensive audit trail.

**Event Types**:
- `command_received` - AI command submitted
- `command_executed` - Command completed
- `command_blocked` - Safety filter triggered
- `approval_granted` / `approval_denied`
- `llm_request` / `llm_response`
- `phi_redaction` - PHI filtering occurred

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run LLM Router integration tests (requires RouterLLM running)
npm test -- --testPathPattern=llm-router.integration

# Run E2E tests (requires running services)
RUN_E2E=true npm run test:e2e

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### LLM Router Integration Tests

The `llm-router.integration.test.ts` tests verify connectivity to the RouterLLM:

- Health & status endpoints
- Embedding generation for all task types
- Chat completions for clinical_decision, documentation, billing_codes
- Model selection and configuration
- Error handling
- Performance benchmarks

These tests automatically skip if RouterLLM is not available.

### Test Structure

```
tests/
├── setup.ts              # Global test setup
├── mocks/
│   ├── medplum-client.ts # Mock Medplum client
│   └── ollama.ts         # Mock LLM Router (OpenAI-compatible + legacy Ollama)
├── fixtures/
│   └── fhir-resources.ts # Sample FHIR data
├── unit/                 # Unit tests per bot
├── integration/          # Multi-bot workflow tests
│   ├── rag-pipeline.integration.test.ts
│   ├── command-approval-workflow.integration.test.ts
│   └── llm-router.integration.test.ts  # RouterLLM connectivity tests
└── e2e/                  # Full stack tests
```

### Shared Services

```
src/
├── services/
│   └── llm-client.ts     # OpenAI-compatible LLM client
│                         # - chatCompletion() for /v1/chat/completions
│                         # - generateEmbedding() for /v1/embeddings
│                         # - splitPromptToMessages() for prompt conversion
```

## Safety & Compliance

### Safety Filters

- Minimum confidence threshold (default: 0.5)
- Blocked operations (medication orders, allergy modifications)
- Dual-approval requirements for high-risk actions
- Quiet hours restrictions

### Provenance Tracking

All AI-generated content includes FHIR Provenance with:
- AI model identification
- Confidence scores
- Clinician verification status
- Retrieval sources

### Audit Events

Every AI action creates a FHIR AuditEvent with:
- Timestamp
- Actor (AI agent + verifier)
- Action type and outcome
- Patient context
- Prompt/response logging (optional)

## Development

### Adding a New Bot

1. Create bot file in `src/`:
```typescript
// src/my-new-bot.ts
import { MedplumClient, BotEvent } from '@medplum/core';

export async function handler(
  medplum: MedplumClient,
  event: BotEvent
): Promise<any> {
  const input = event.input;
  // Bot logic here
  return { success: true };
}
```

2. Add types in `src/types/`:
3. Create unit tests in `tests/unit/`
4. Update exports in `src/index.ts`

### Building

```bash
# Compile TypeScript
npm run build

# Type check only
npx tsc --noEmit
```

## Deployment

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deploy

```bash
# Deploy all bots to Medplum
npm run deploy

# Deploy specific bot
npm run deploy -- --bot embedding-bot
```

## API Documentation

See [API.md](./docs/API.md) for detailed API documentation for each bot.

## License

MIT
