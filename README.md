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

## Project Structure

```
fabricEMR/
├── bots/                      # AI Bot source code
│   ├── src/                   # TypeScript source files
│   ├── dist/                  # Compiled JavaScript
│   └── docs/                  # Bot-specific documentation
├── config/                    # Configuration files
│   ├── litellm-config.yaml    # LLM Gateway routing
│   ├── safety-filters.yaml    # AI safety rules
│   └── postgres-init.sql      # pgvector setup
├── profiles/                  # FHIR profiles
├── sql/                       # Database scripts
├── docker-compose.yml         # Service orchestration
├── medplum.config.json        # Medplum server config
├── deploy-bots.js             # Bot deployment script
├── create-subscriptions.js    # Subscription setup script
├── verify-deployment.js       # Deployment verification
├── ARCHITECTURE.md            # System architecture
├── CURRENT_STATUS.md          # Current deployment status
├── SCRIBE_INTEGRATION.md      # AI Scribe app documentation
└── FLUTTER_FRONTEND_PROMPT.md # Frontend planning
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FabricEMR Stack                             │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Medplum App  │  │  AI Bots     │  │   Clinician Dashboard    │  │
│  │  (Port 3000) │  │  (9 bots)    │  │      (Approval UI)       │  │
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
│  │  (external) │    │  (optional) │    │ nomic-embed │             │
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
- Ollama running externally with models: `qwen3:4b`, `nomic-embed-text`

### 1. Start Services

```bash
# Start all Docker services
docker compose up -d

# Wait for services to be healthy (~60 seconds)
docker compose ps
```

### 2. Access the Application

| Service | URL | Credentials |
|---------|-----|-------------|
| Medplum App | http://localhost:3000 | admin@example.com / medplum |
| Medplum API | http://localhost:8103 | Same as above |
| LLM Gateway | http://localhost:8080 | API Key: sk-medplum-ai |

### 3. Verify Bots are Deployed

```bash
node verify-deployment.js
```

## Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| postgres | pgvector/pgvector:pg16 | 5432 | FHIR data + vector embeddings |
| redis | redis:7 | 6379 | Caching and queues |
| medplum-server | medplum/medplum-server | 8103 | FHIR server + bot runtime |
| medplum-app | medplum/medplum-app | 3000 | Web application |
| llm-gateway | berriai/litellm | 8080 | AI request routing |

**Note:** Ollama runs on an external server (configurable via `OLLAMA_API_BASE` in `.env`).

## Deployed AI Bots

All 9 bots are deployed and running in Medplum:

| Bot | ID | Trigger | Description |
|-----|----|---------|-------------|
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` | Auto: clinical resources | Generates vector embeddings |
| Semantic Search Bot | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | API | Vector similarity search |
| RAG Pipeline Bot | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | API | Clinical Q&A with context |
| Command Processor Bot | `87780e52-abc5-4122-8225-07e74aaf18ca` | API | Validates AI commands |
| Approval Queue Bot | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Auto: Task | Human approval workflow |
| Clinical Decision Support Bot | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | Auto: Encounter, MedicationRequest | Diagnosis, drug interactions |
| Documentation Assistant Bot | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | API | Generate clinical notes |
| Billing Code Suggester Bot | `093a0c9d-44ea-4672-8208-d1d199962f33` | Auto: Encounter (finished) | CPT/ICD-10 suggestions |
| Audit Logging Bot | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | API | AI audit trail |

See [bots/README.md](./bots/README.md) for detailed bot documentation.

## Active Subscriptions

The following subscriptions automatically trigger bots:

| Subscription | Criteria | Target Bot |
|--------------|----------|------------|
| Embedding - DiagnosticReport | `DiagnosticReport` | Embedding Bot |
| Embedding - DocumentReference | `DocumentReference` | Embedding Bot |
| Embedding - Observation | `Observation` | Embedding Bot |
| Embedding - Condition | `Condition` | Embedding Bot |
| Embedding - MedicationStatement | `MedicationStatement` | Embedding Bot |
| CDS - Encounter | `Encounter` | Clinical Decision Support Bot |
| CDS - MedicationRequest | `MedicationRequest` | Clinical Decision Support Bot |
| Billing - Encounter Finished | `Encounter?status=finished` | Billing Code Suggester Bot |
| Approval Queue - Task | `Task?code=ai-approval` | Approval Queue Bot |

## Invoking API Bots

Bots without subscriptions are invoked via the FHIR API:

```bash
# Get auth token
curl -X POST http://localhost:8103/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}'

# Exchange code for token
curl -X POST http://localhost:8103/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=<CODE>&code_verifier=test"

# Execute a bot
curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"input": {...}}'
```

### Example: Semantic Search

```bash
curl -X POST "http://localhost:8103/fhir/R4/Bot/e8d04e1d-7309-463b-ba7b-86dda61e3bbe/\$execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "patient with uncontrolled blood pressure",
    "patientId": "patient-123",
    "limit": 10
  }'
```

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

## Development

### Rebuild and Redeploy Bots

```bash
cd bots
npm install
npm run build
cd ..
node deploy-bots.js
```

### Recreate Subscriptions

```bash
node create-subscriptions.js
```

### Verify Deployment

```bash
node verify-deployment.js
```

### Run Tests

```bash
cd bots
npm test                    # Unit tests
npm run test:integration    # Integration tests
RUN_E2E=true npm run test:e2e  # E2E tests
```

## Configuration

### LLM Gateway

Edit `config/litellm-config.yaml` to configure models:

```yaml
model_list:
  - model_name: phi-safe/clinical
    litellm_params:
      model: ollama/qwen3:4b
      api_base: ${OLLAMA_API_BASE}
```

### Safety Rules

Edit `config/safety-filters.yaml` to customize guardrails.

### Environment Variables

Key variables in `.env`:
- `OLLAMA_API_BASE` - Ollama server URL (default: http://host.docker.internal:11434)
- `LITELLM_API_KEY` - LLM Gateway API key (default: sk-medplum-ai)
- `POSTGRES_PASSWORD` - Database password
- `REDIS_PASSWORD` - Redis password

## Documentation

- [Architecture](./ARCHITECTURE.md) - System design and data flow
- [Current Status](./CURRENT_STATUS.md) - Deployment status and pending work
- [Bot API Reference](./bots/docs/API.md) - Complete API documentation
- [Deployment Guide](./bots/docs/DEPLOYMENT.md) - Deployment instructions
- [Scribe Integration](./SCRIBE_INTEGRATION.md) - AI Scribe app documentation
- [Frontend Planning](./FLUTTER_FRONTEND_PROMPT.md) - Flutter app design

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
