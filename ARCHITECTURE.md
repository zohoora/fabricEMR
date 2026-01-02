# FabricEMR Architecture

This document describes the system architecture, data flows, and key design decisions for FabricEMR.

## System Overview

FabricEMR is an AI-enhanced Electronic Medical Record system built on three core principles:

1. **FHIR-Native**: All data stored as standard FHIR R4 resources
2. **Privacy-First**: PHI never leaves local infrastructure
3. **Human-in-the-Loop**: AI assists but clinicians approve

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │  Medplum App   │  │  FabricScribe  │  │  Third-Party FHIR Clients     │ │
│  │  (React Web)   │  │  (Flutter App) │  │  (Mobile, Desktop, etc.)      │ │
│  │  Port 3000     │  │  iOS/Android   │  │                                │ │
│  └───────┬────────┘  └───────┬────────┘  └───────────────┬────────────────┘ │
│          │                   │                           │                   │
│          └───────────────────┼───────────────────────────┘                   │
│                              │                                               │
│                              ▼                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                              API LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Medplum Server (Port 8103)                         │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │   │
│  │  │  FHIR R4    │ │    Auth     │ │Subscriptions│ │   Bot Runtime   │ │   │
│  │  │    API      │ │   OAuth2    │ │   Engine    │ │  (VM Context)   │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                              BOT LAYER (9 Bots)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Data Ingestion          │ AI Processing          │ Output/Actions    │   │
│  │ ┌─────────────────────┐ │ ┌─────────────────────┐│┌─────────────────┐│   │
│  │ │   Embedding Bot     │ │ │ Semantic Search Bot ││ │ Approval Queue ││   │
│  │ │   (auto-trigger)    │ │ │ RAG Pipeline Bot    ││ │ Audit Logging  ││   │
│  │ └─────────────────────┘ │ │ CDS Bot             ││ │ Bot            ││   │
│  │                         │ │ Doc Assistant Bot   ││ └─────────────────┘│   │
│  │ ┌─────────────────────┐ │ │ Billing Bot         ││                    │   │
│  │ │ Command Processor   │ │ │ (API-invoked)       ││                    │   │
│  │ │ (validates/routes)  │ │ └─────────────────────┘│                    │   │
│  │ └─────────────────────┘ │                        │                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                              AI LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    LLM Gateway / LiteLLM (Port 8080)                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │   │
│  │  │   Routing   │ │Rate Limiting│ │   Logging   │ │ Model Selection │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘ │   │
│  └────────────────────────────────┬─────────────────────────────────────┘   │
│                                   │                                          │
│           ┌───────────────────────┼───────────────────────┐                  │
│           ▼                       ▼                       ▼                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │     Ollama      │    │   Cloud LLMs    │    │   Embeddings    │          │
│  │   (External)    │    │   (Optional)    │    │  nomic-embed    │          │
│  │   qwen3:4b      │    │   GPT-4, etc    │    │                 │          │
│  │   [PHI-SAFE]    │    │   [REDACTED]    │    │   [PHI-SAFE]    │          │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘          │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                              DATA LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  ┌────────────────────────────┐ │
│  │     PostgreSQL 16 + pgvector           │  │        Redis 7             │ │
│  │     (Port 5432)                        │  │      (Port 6379)           │ │
│  │  ┌──────────────┐ ┌──────────────────┐ │  │  ┌────────────────────────┐│ │
│  │  │ FHIR Tables  │ │ clinical_        │ │  │  │  Session Cache         ││ │
│  │  │ Patient      │ │ embeddings       │ │  │  │  Job Queue             ││ │
│  │  │ Observation  │ │ (768-dim vectors)│ │  │  │  Rate Limiting         ││ │
│  │  │ Condition    │ │                  │ │  │  └────────────────────────┘│ │
│  │  │ Bot          │ │ ┌──────────────┐ │ │  └────────────────────────────┘ │
│  │  │ Subscription │ │ │ivfflat index │ │ │                                 │
│  │  │ Binary       │ │ │cosine search │ │ │                                 │
│  │  │ AuditEvent   │ │ └──────────────┘ │ │                                 │
│  │  └──────────────┘ └──────────────────┘ │                                 │
│  └────────────────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Embedding Generation Flow

When a clinical resource is created or updated:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Medplum    │────▶│ Subscription │────▶│  Embedding   │
│  (creates    │     │   Server     │     │   Engine     │     │    Bot       │
│  Condition)  │     │              │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                       │
                     ┌──────────────┐     ┌──────────────┐            │
                     │   pgvector   │◀────│   Ollama     │◀───────────┘
                     │  (stores     │     │ nomic-embed  │
                     │  embedding)  │     │  (generates) │
                     └──────────────┘     └──────────────┘
```

### 2. Semantic Search Flow

When a user queries for similar clinical data:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Medplum    │────▶│  Semantic    │
│  (query:     │     │   Server     │     │  Search Bot  │
│  "diabetes") │     │  $execute    │     │              │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
       ┌──────────────────────────────────────────┤
       │                                          │
       ▼                                          ▼
┌──────────────┐                          ┌──────────────┐
│   Ollama     │                          │   pgvector   │
│ (embed query)│─────────────────────────▶│(cosine search│
│              │        query vector      │  top-K)      │
└──────────────┘                          └──────┬───────┘
                                                  │
                     ┌──────────────┐            │
                     │   Results    │◀───────────┘
                     │ (ranked by   │
                     │  similarity) │
                     └──────────────┘
```

### 3. RAG (Retrieval-Augmented Generation) Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Medplum    │────▶│     RAG      │
│  (question:  │     │   Server     │     │  Pipeline    │
│  "HbA1c?")   │     │  $execute    │     │     Bot      │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                           ┌──────────────────────┤
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐       ┌──────────────┐
                    │  Semantic    │       │   pgvector   │
                    │  Search Bot  │◀─────▶│  (retrieve   │
                    │  (reused)    │       │   context)   │
                    └──────────────┘       └──────────────┘
                           │
                           ▼
                    ┌──────────────┐       ┌──────────────┐
                    │   Prompt     │──────▶│    Ollama    │
                    │  Assembly    │       │  qwen3:4b    │
                    │ (question +  │       │ (generate    │
                    │  context)    │       │  answer)     │
                    └──────────────┘       └──────┬───────┘
                                                  │
                                                  ▼
                                           ┌──────────────┐
                                           │   Answer     │
                                           │ + Citations  │
                                           │ + Confidence │
                                           └──────────────┘
```

### 4. Human-in-the-Loop Approval Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  AI Bot      │────▶│   Command    │────▶│   Approval   │
│ (generates   │     │  Processor   │     │    Queue     │
│  suggestion) │     │  (validates) │     │     Bot      │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                           ┌──────────────┐
                                           │ FHIR Task    │
                                           │ (status:     │
                                           │  requested)  │
                                           └──────┬───────┘
                                                  │
                     ┌────────────────────────────┤
                     │                            │
                     ▼                            ▼
              ┌──────────────┐            ┌──────────────┐
              │  Clinician   │            │   Timeout    │
              │  Reviews     │            │   (expires)  │
              │              │            │              │
              └──────┬───────┘            └──────┬───────┘
                     │                           │
         ┌──────────┴──────────┐                │
         │                     │                │
         ▼                     ▼                ▼
  ┌──────────────┐     ┌──────────────┐  ┌──────────────┐
  │   Approve    │     │   Reject     │  │   Expire     │
  │ (executes    │     │ (logs        │  │ (logs        │
  │  command)    │     │  rejection)  │  │  timeout)    │
  └──────────────┘     └──────────────┘  └──────────────┘
```

## Bot Responsibilities

### Data Ingestion Layer

| Bot | Responsibility | Trigger |
|-----|----------------|---------|
| **Embedding Bot** | Converts clinical text to 768-dim vectors | Subscription on resource create/update |
| **Command Processor** | Validates, filters, routes AI commands | Called by other bots |

### AI Processing Layer

| Bot | Responsibility | Invocation |
|-----|----------------|------------|
| **Semantic Search** | Vector similarity search | API call |
| **RAG Pipeline** | Question answering with citations | API call |
| **Clinical Decision Support** | Diagnosis, interactions, care gaps | Subscription or API |
| **Documentation Assistant** | Generate clinical notes | API call |
| **Billing Code Suggester** | CPT/ICD-10 recommendations | Subscription on Encounter |

### Output Layer

| Bot | Responsibility | Trigger |
|-----|----------------|---------|
| **Approval Queue** | Human-in-the-loop workflow | Subscription on Task |
| **Audit Logging** | Comprehensive audit trail | Called by other bots |

## Database Schema

### FHIR Resources (Medplum Managed)

Standard FHIR R4 tables managed by Medplum:
- `Patient`, `Practitioner`, `Organization`
- `Encounter`, `Condition`, `Observation`
- `MedicationRequest`, `DiagnosticReport`
- `DocumentReference`, `Binary`
- `Bot`, `Subscription`
- `Task`, `AuditEvent`, `Provenance`

### Vector Embeddings (Custom)

```sql
CREATE TABLE clinical_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fhir_resource_type VARCHAR(100) NOT NULL,
    fhir_resource_id UUID NOT NULL,
    patient_id UUID,
    content_type VARCHAR(50),       -- 'narrative', 'code', 'note'
    content_section VARCHAR(100),   -- 'subjective', 'assessment', etc.
    chunk_index INTEGER DEFAULT 0,
    content_text TEXT,
    embedding VECTOR(768),          -- nomic-embed-text dimension
    model_version VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(fhir_resource_id, chunk_index)
);

-- IVFFlat index for fast cosine similarity search
CREATE INDEX ON clinical_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Lookup indexes
CREATE INDEX idx_embeddings_resource ON clinical_embeddings(fhir_resource_type, fhir_resource_id);
CREATE INDEX idx_embeddings_patient ON clinical_embeddings(patient_id);
```

## Security Architecture

### PHI Protection

```
┌─────────────────────────────────────────────────────────────┐
│                    PHI Boundary                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Ollama    │  │  pgvector   │  │   Medplum Server    │  │
│  │ (local LLM) │  │(embeddings) │  │   (FHIR data)       │  │
│  │             │  │             │  │                     │  │
│  │ PHI allowed │  │ PHI allowed │  │   PHI allowed       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  All components run on-premises or in private cloud          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ (redacted/anonymized only)
                            ▼
              ┌─────────────────────────┐
              │    Cloud LLMs           │
              │   (GPT-4, Claude)       │
              │                         │
              │   NO PHI allowed        │
              └─────────────────────────┘
```

### Authentication Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│  /auth/login │────▶│   Validate   │
│  (email/pwd) │     │              │     │  Credentials │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌──────────────┐            │
                     │ Login Object │◀───────────┘
                     │ + Code       │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐     ┌──────────────┐
                     │/oauth2/token │────▶│ Access Token │
                     │ (PKCE flow)  │     │ (1 hour TTL) │
                     └──────────────┘     └──────────────┘
```

### Authorization Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Medplum Project                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Access Policies                        ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  ││
│  │  │   Admin     │  │  Clinician  │  │   AI Bot        │  ││
│  │  │   Full      │  │  Read/Write │  │  Limited Write  │  ││
│  │  │   Access    │  │  Patient    │  │  + Provenance   │  ││
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Project Members                        ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  ││
│  │  │Practitioner │  │   Patient   │  │  Bot Service    │  ││
│  │  │  (users)    │  │  (portal)   │  │  (automated)    │  ││
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Deployment Topology

### Development (Current)

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │ postgres │ │  redis   │ │ medplum- │ │   medplum-app    ││
│  │          │ │          │ │  server  │ │                  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐│
│  │                    llm-gateway                            ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            │ (external)
                            ▼
                     ┌──────────────┐
                     │    Ollama    │
                     │  (separate   │
                     │   machine)   │
                     └──────────────┘
```

### Production (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Ingress (HTTPS)                                          ││
│  └────────────────────────┬─────────────────────────────────┘│
│                           │                                  │
│  ┌────────────────────────┼─────────────────────────────────┐│
│  │                        ▼                                  ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  ││
│  │  │ medplum  │ │ medplum  │ │ medplum  │  (3 replicas)    ││
│  │  │ server   │ │ server   │ │ server   │                  ││
│  │  └──────────┘ └──────────┘ └──────────┘                  ││
│  │                                                           ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  ││
│  │  │   LLM    │ │   LLM    │ │   LLM    │  (3 replicas)    ││
│  │  │ gateway  │ │ gateway  │ │ gateway  │                  ││
│  │  └──────────┘ └──────────┘ └──────────┘                  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ PostgreSQL (HA)          │  Redis Cluster                ││
│  │  Primary + Replicas      │  3 nodes                      ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       ┌──────────────┐           ┌──────────────┐
       │ Ollama GPU   │           │ Ollama GPU   │
       │  Server 1    │           │  Server 2    │
       └──────────────┘           └──────────────┘
```

## Key Design Decisions

### 1. Why Medplum?

- **Open Source**: Full control, no vendor lock-in
- **FHIR Native**: Standard-compliant from the ground up
- **Bot Runtime**: Built-in serverless function execution
- **Subscription Engine**: Real-time event triggers

### 2. Why pgvector over Pinecone/Weaviate?

- **Co-located**: Same database as FHIR data
- **Transactional**: ACID guarantees with FHIR updates
- **Simple**: No additional infrastructure
- **Cost**: No per-query pricing

### 3. Why Ollama for PHI?

- **Local Execution**: Data never leaves infrastructure
- **No API Calls**: No network exposure of PHI
- **Audit Friendly**: Full control over logging
- **Cost Predictable**: No per-token charges

### 4. Why LiteLLM Gateway?

- **Unified API**: Same interface for all models
- **Routing**: PHI vs non-PHI model selection
- **Rate Limiting**: Prevent abuse
- **Logging**: Centralized request tracking

## Performance Considerations

### Embedding Generation

- **Batch Size**: Process up to 10 resources per invocation
- **Chunking**: 500 chars with 50 char overlap
- **Async**: Non-blocking, background processing

### Vector Search

- **Index Type**: IVFFlat with 100 lists
- **Probe Count**: 10 (tradeoff: speed vs accuracy)
- **Top-K**: Default 10, max 100

### LLM Inference

- **Model**: qwen3:4b (balance of speed/quality)
- **Context**: Max 4096 tokens
- **Temperature**: 0.3 for factual, 0.7 for creative

## Monitoring & Observability

### Metrics to Track

1. **Bot Execution**
   - Duration per bot
   - Success/failure rate
   - Queue depth (approval tasks)

2. **LLM Performance**
   - Tokens per request
   - Response latency
   - Model error rate

3. **Vector Search**
   - Query latency
   - Index size
   - Similarity score distribution

### Logging Strategy

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Bot Logs    │────▶│  AuditEvent  │────▶│   External   │
│  (console)   │     │  (FHIR)      │     │   SIEM       │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Provenance  │
                     │  (AI trail)  │
                     └──────────────┘
```

## Future Considerations

1. **Multi-tenancy**: Separate projects per organization
2. **Model Fine-tuning**: Domain-specific model training
3. **Real-time Streaming**: WebSocket for live updates
4. **Mobile Offline**: Local embedding + sync
5. **Federated Learning**: Cross-institution insights
