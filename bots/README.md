# Medplum AI Bots

AI-native extensions for Medplum that provide semantic search, clinical decision support, and AI-assisted clinical documentation.

## Overview

This package contains a suite of Medplum bots that integrate local LLMs (via Ollama) to provide intelligent healthcare automation while maintaining patient safety and regulatory compliance.

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
│  │                   Command Processor                        │ │
│  │  (validates, filters, routes AI commands)                  │ │
│  └────────┬────────────────────┬────────────────────┬────────┘ │
│           │                    │                    │          │
│  ┌────────┴────────┐  ┌───────┴───────┐  ┌────────┴────────┐  │
│  │ Approval Queue  │  │ Audit Logger  │  │ Safety Filters  │  │
│  └─────────────────┘  └───────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      External Services                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Ollama (LLM)    │  │   PostgreSQL    │  │ Medplum Server  │ │
│  │ + nomic-embed   │  │   + pgvector    │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- Docker with Colima (macOS) or Docker Desktop
- Medplum server running locally
- Ollama with required models:
  - `llama3.2:3b` for text generation
  - `nomic-embed-text` for embeddings

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

# Ollama connection
OLLAMA_BASE_URL=http://localhost:11434

# LLM Gateway (optional)
LLM_GATEWAY_URL=http://localhost:8080
LLM_GATEWAY_API_KEY=sk-medplum-ai
```

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

# Run E2E tests (requires running services)
RUN_E2E=true npm run test:e2e

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Test Structure

```
tests/
├── setup.ts              # Global test setup
├── mocks/
│   ├── medplum-client.ts # Mock Medplum client
│   └── ollama.ts         # Mock Ollama API
├── fixtures/
│   └── fhir-resources.ts # Sample FHIR data
├── unit/                 # Unit tests per bot
├── integration/          # Multi-bot workflow tests
└── e2e/                  # Full stack tests
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
