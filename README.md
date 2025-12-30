# FabricEMR

AI-native healthcare platform built on [Medplum](https://www.medplum.com/) with semantic search, RAG (Retrieval-Augmented Generation), and clinical decision support.

## Overview

FabricEMR extends the open-source Medplum FHIR server with AI capabilities while maintaining patient safety, regulatory compliance, and full audit trails. All PHI-sensitive operations run on local LLMs—no patient data leaves your infrastructure.

### Key Features

- **Semantic Search** - Vector-based clinical document search using pgvector
- **RAG Pipeline** - Ground LLM responses in actual patient data
- **Clinical Decision Support** - AI-powered analysis with safety guardrails
- **Documentation Assistant** - Auto-generate clinical notes (SOAP, discharge summaries, referrals)
- **Billing Code Suggester** - AI-assisted CPT/ICD-10 recommendations
- **Human-in-the-Loop** - Approval workflows for AI suggestions
- **Full Provenance** - FHIR-compliant audit trail for all AI actions

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FabricEMR Stack                             │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Medplum App  │  │  AI Bots     │  │   Clinician Dashboard    │  │
│  │  (Port 3000) │  │              │  │      (Approval UI)       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                       │                 │
│  ┌──────┴─────────────────┴───────────────────────┴──────────────┐  │
│  │                    LLM Gateway (Port 8080)                     │  │
│  │  • PHI-aware routing  • Rate limiting  • Safety filters       │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                             │                                       │
│         ┌───────────────────┼───────────────────┐                   │
│         ▼                   ▼                   ▼                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │   Ollama    │    │  Cloud LLM  │    │  Embeddings │             │
│  │ llama3.2:3b │    │  (optional) │    │ nomic-embed │             │
│  │ [PHI-safe]  │    │ [redacted]  │    │   [local]   │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Medplum Server (Port 8103)                       │  │
│  │  • FHIR R4 API  • Bot execution  • Subscriptions              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              PostgreSQL 16 + pgvector (Port 5432)             │  │
│  │  ┌─────────────────┐  ┌────────────────────────────────────┐ │  │
│  │  │   FHIR Data     │  │   Vector Embeddings (768-dim)      │ │  │
│  │  └─────────────────┘  └────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker 20.10+ with Docker Compose V2
- 16GB RAM minimum (32GB recommended)
- macOS, Linux, or WSL2

### 1. Clone and Configure

```bash
git clone https://github.com/zohoora/fabricEMR.git
cd fabricEMR

# Copy config templates
cp medplum.config.example.json medplum.config.json
cp .env.example .env

# Edit .env to set your Ollama server URL (if not on localhost)
# OLLAMA_API_BASE=http://your-ollama-server:11434
```

### 2. Start Services

```bash
# Start all services
docker compose up -d

# Wait for services to be healthy (~60 seconds)
docker compose ps
```

### 3. Ensure AI Models are Available

The app connects to an external Ollama server. Ensure these models are installed:

```bash
# On your Ollama server
ollama pull qwen3:4b
ollama pull nomic-embed-text
```

### 4. Initialize Vector Database

```bash
# Create the embeddings table
docker exec -it $(docker ps -qf "name=postgres") psql -U medplum -d medplum -f /dev/stdin < sql/embeddings.sql
```

### 5. Access the Application

| Service | URL | Description |
|---------|-----|-------------|
| Medplum App | http://localhost:3000 | Web UI for EHR |
| Medplum API | http://localhost:8103 | FHIR R4 API |
| LLM Gateway | http://localhost:8080 | AI routing layer |
| Ollama | http://localhost:11434 | Local LLM inference |

## Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| postgres | pgvector/pgvector:pg16 | 5432 | FHIR data + vector embeddings |
| redis | redis:7 | 6379 | Caching and queues |
| medplum-server | medplum/medplum-server | 8103 | FHIR server + bot runtime |
| medplum-app | medplum/medplum-app | 3000 | Web application |
| ollama | ollama/ollama | 11434 | Local LLM inference |
| llm-gateway | berriai/litellm | 8080 | AI request routing |

## AI Bots

FabricEMR includes 9 specialized bots for clinical AI workflows:

| Bot | Purpose |
|-----|---------|
| `embedding-bot` | Generate vector embeddings for FHIR resources |
| `semantic-search-bot` | Similarity search across clinical data |
| `rag-pipeline-bot` | Answer questions using retrieved context |
| `command-processor-bot` | Validate and route AI commands |
| `approval-queue-bot` | Human-in-the-loop approval workflow |
| `clinical-decision-support-bot` | Diagnosis suggestions, drug interactions |
| `documentation-assistant-bot` | Generate clinical notes |
| `billing-code-suggester-bot` | CPT/ICD-10 recommendations |
| `audit-logging-bot` | Comprehensive AI audit trail |

See [bots/README.md](./bots/README.md) for detailed documentation.

## Safety & Compliance

### PHI Protection

- All PHI-sensitive operations use **local LLMs** (Ollama)
- Cloud LLMs only receive redacted/anonymized data
- No patient data leaves your infrastructure

### Safety Filters

```yaml
# Blocked operations (AI cannot execute)
- Medication orders
- Allergy modifications
- Controlled substance prescriptions

# Requires human approval
- Clinical note creation
- Problem list updates
- Billing code submission
```

### Audit Trail

Every AI action creates FHIR-compliant audit records:
- `Provenance` resources track AI model, confidence, and human verification
- `AuditEvent` resources log all operations
- Full prompt/response logging (configurable)

## Configuration

### LLM Gateway

Edit `config/litellm-config.yaml` to configure models:

```yaml
model_list:
  - model_name: phi-safe/clinical
    litellm_params:
      model: ollama/llama3.2:3b
      api_base: http://ollama:11434

  # Optional: Add cloud models for non-PHI tasks
  # - model_name: general/fast
  #   litellm_params:
  #     model: gpt-4o-mini
  #     api_key: ${OPENAI_API_KEY}
```

### Safety Rules

Edit `config/safety-filters.yaml` to customize guardrails.

## Development

### Build Bots

```bash
cd bots
npm install
npm run build
```

### Run Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests (requires running services)
RUN_E2E=true npm run test:e2e
```

### Deploy Bots

```bash
npm run deploy
```

## API Examples

### Generate Embedding

```bash
curl -X POST http://localhost:8080/v1/embeddings \
  -H "Authorization: Bearer sk-medplum-ai" \
  -H "Content-Type: application/json" \
  -d '{"model": "embeddings/local", "input": "Patient with hypertension"}'
```

### Chat Completion

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-medplum-ai" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "phi-safe/clinical",
    "messages": [{"role": "user", "content": "What are the symptoms of diabetes?"}]
  }'
```

### Semantic Search (via Bot)

```typescript
const results = await medplum.executeBot('semantic-search-bot', {
  query: "patients with uncontrolled blood pressure",
  patientId: "patient-123",
  limit: 10
});
```

## Documentation

- [Bot API Reference](./bots/docs/API.md)
- [Deployment Guide](./bots/docs/DEPLOYMENT.md)
- [FHIR Profiles](./profiles/)

## Tech Stack

- **Medplum** - Open-source FHIR platform
- **PostgreSQL + pgvector** - Vector similarity search
- **Ollama** - Local LLM inference
- **LiteLLM** - LLM gateway and routing
- **TypeScript** - Bot development
- **Jest** - Testing framework

## License

MIT

## Acknowledgments

- [Medplum](https://www.medplum.com/) - FHIR platform
- [Ollama](https://ollama.ai/) - Local LLM runtime
- [LiteLLM](https://github.com/BerriAI/litellm) - LLM proxy
- [pgvector](https://github.com/pgvector/pgvector) - Vector extensions for PostgreSQL
