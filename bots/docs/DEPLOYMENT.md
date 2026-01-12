# Medplum AI Bots Deployment Guide

Complete guide for deploying the AI-native Medplum stack with all bots and services.

## Current Deployment Status

**All 9 bots are deployed and running.** This guide documents both the current setup and how to redeploy if needed.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Infrastructure Setup](#infrastructure-setup)
- [Bot Deployment](#bot-deployment)
- [Subscription Configuration](#subscription-configuration)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32+ GB |
| Storage | 50 GB | 100+ GB SSD |
| GPU | - | NVIDIA with 8GB+ VRAM (for faster inference) |

### Software Requirements

- Docker 20.10+ with Docker Compose V2
- Node.js 18+ and npm 9+
- Git

### macOS Setup

```bash
# Docker Desktop is recommended for macOS
# Download from https://www.docker.com/products/docker-desktop

# Verify Docker is running
docker info
```

---

## Infrastructure Setup

### 1. Clone and Prepare

```bash
# Navigate to Medplum directory
cd ~/medplum

# Ensure bots directory exists
cd bots
npm install
npm run build
```

### 2. Start Docker Services

The AI stack requires the following services in `docker-compose.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: always
    environment:
      - POSTGRES_USER=medplum
      - POSTGRES_PASSWORD=medplum
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U medplum']
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    restart: always
    command: redis-server --requirepass medplum
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', 'medplum', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5

  medplum-server:
    image: medplum/medplum-server:latest
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - '8103:8103'
    environment:
      - MEDPLUM_PORT=8103
      - MEDPLUM_BASE_URL=http://localhost:8103/
      - MEDPLUM_DATABASE_HOST=postgres
      - MEDPLUM_DATABASE_PORT=5432
      - MEDPLUM_DATABASE_NAME=medplum
      - MEDPLUM_DATABASE_USERNAME=medplum
      - MEDPLUM_DATABASE_PASSWORD=medplum
      - MEDPLUM_REDIS_HOST=redis
      - MEDPLUM_REDIS_PORT=6379
      - MEDPLUM_REDIS_PASSWORD=medplum
      - MEDPLUM_VM_CONTEXT_BOTS_ENABLED=true

  medplum-app:
    image: medplum/medplum-app:latest
    restart: always
    depends_on:
      medplum-server:
        condition: service_healthy
    ports:
      - '3000:3000'

  ollama:
    image: ollama/ollama:latest
    restart: always
    ports:
      - '11434:11434'
    volumes:
      - ollama_data:/root/.ollama
    # For GPU support (NVIDIA):
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]

  llm-gateway:
    image: ghcr.io/berriai/litellm:main-latest
    restart: always
    depends_on:
      - ollama
      - postgres
    ports:
      - '8080:4000'
    environment:
      - LITELLM_MASTER_KEY=sk-medplum-ai
      - DATABASE_URL=postgresql://medplum:medplum@postgres:5432/medplum
      - OLLAMA_API_BASE=http://ollama:11434
    volumes:
      - ./config/litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml"]

volumes:
  postgres_data:
  ollama_data:
```

Start services:

```bash
cd ~/medplum
docker compose up -d

# Check all services are running
docker compose ps
```

### 3. Configure LLM Router

The bots communicate with an LLM Router that provides OpenAI-compatible API. Configure the router to expose:

**Required Endpoints:**
- `POST /v1/chat/completions` - For text generation
- `POST /v1/embeddings` - For embedding generation
- `GET /v1/models` - For model listing

**Model Aliases:**
- `clinical-model` - Routes to text generation model (e.g., qwen3:4b)
- `embedding-model` - Routes to embedding model (e.g., nomic-embed-text, 768-dim)

**If using Ollama as backend:**
```bash
# Pull required models
docker exec -it ollama ollama pull qwen3:4b
docker exec -it ollama ollama pull nomic-embed-text

# Verify models
docker exec -it ollama ollama list
```

### 4. Initialize pgvector

```bash
# Connect to PostgreSQL
docker exec -it postgres psql -U medplum -d medplum

# Run these SQL commands
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS clinical_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_resource_type VARCHAR(100) NOT NULL,
  fhir_resource_id UUID NOT NULL,
  patient_id UUID,
  content_type VARCHAR(50),
  chunk_index INTEGER DEFAULT 0,
  content_text TEXT,
  embedding VECTOR(768),
  model_version VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fhir_resource_id, chunk_index)
);

CREATE INDEX ON clinical_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_embeddings_resource ON clinical_embeddings(fhir_resource_type, fhir_resource_id);
CREATE INDEX idx_embeddings_patient ON clinical_embeddings(patient_id);

\q
```

---

## Bot Deployment

### 1. Build Bots

```bash
cd ~/medplum/bots

# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify build
ls -la dist/
```

### 2. Deploy Bot Code

Use the deployment script from the project root:

```bash
cd ~/medplum

# Deploy all bots (creates Bot resources and uploads code)
node deploy-bots.js
```

The script performs these steps for each bot:
1. Creates a Binary resource containing the compiled JavaScript
2. Creates or updates the Bot resource with `runtimeVersion: vmcontext`
3. Links both `sourceCode` and `executableCode` to the Binary

**Deployed Bot IDs:**

| Bot | Medplum ID |
|-----|------------|
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` |
| Semantic Search Bot | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` |
| RAG Pipeline Bot | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` |
| Command Processor Bot | `87780e52-abc5-4122-8225-07e74aaf18ca` |
| Approval Queue Bot | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` |
| Clinical Decision Support Bot | `cee8c207-bd20-42c3-aaf4-0055c1f90853` |
| Documentation Assistant Bot | `b8b85bb2-e447-4556-a314-0da1ba06afe5` |
| Billing Code Suggester Bot | `093a0c9d-44ea-4672-8208-d1d199962f33` |
| Audit Logging Bot | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` |

### 3. Verify Deployment

```bash
node verify-deployment.js
```

Expected output:
```
=== DEPLOYED BOTS ===
✓ Embedding Bot (has executable code)
✓ Semantic Search Bot (has executable code)
... (all 9 bots)

=== SUBSCRIPTIONS ===
✓ Embedding - DiagnosticReport
... (all 9 subscriptions)
```

---

## Subscription Configuration

Use the subscription creation script to set up automatic bot triggers:

```bash
cd ~/medplum
node create-subscriptions.js
```

### Active Subscriptions

The script creates these subscriptions:

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

### Manual Subscription Creation

If needed, you can create subscriptions manually via the API:

```bash
# Get auth token first (see Authentication section below)

# Create a subscription
curl -X POST "http://localhost:8103/fhir/R4/Subscription" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Subscription",
    "status": "active",
    "reason": "Trigger embedding generation",
    "criteria": "DiagnosticReport",
    "channel": {
      "type": "rest-hook",
      "endpoint": "Bot/d089f714-f746-4e97-a361-c5c1b376d13b"
    }
  }'
```

### Authentication

The deployment scripts use PKCE OAuth2 flow:

```bash
# Step 1: Login
curl -X POST http://localhost:8103/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "medplum",
    "scope": "openid",
    "codeChallenge": "test",
    "codeChallengeMethod": "plain"
  }'
# Response: {"login":"...","code":"abc123"}

# Step 2: Exchange code for token
curl -X POST http://localhost:8103/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=abc123&code_verifier=test"
# Response: {"access_token":"eyJ...","token_type":"Bearer",...}
```

**Default Credentials:**
- Email: `admin@example.com`
- Password: `medplum`

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check all services
docker compose ps

# Check Medplum server
curl http://localhost:8103/healthcheck

# Check LLM Router (OpenAI-compatible)
curl http://localhost:4000/v1/models
# or
curl http://localhost:4000/health

# Check Ollama (if direct access needed)
curl http://localhost:11434/api/tags

# Check LLM Gateway (legacy)
curl http://localhost:8080/health
```

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f medplum-server
docker compose logs -f ollama

# Bot execution logs (in Medplum)
medplum get "AuditEvent?type=execute&agent=Bot"
```

### Performance Monitoring

Monitor key metrics:

1. **Embedding generation time**: Should be < 2s per resource
2. **Search latency**: Should be < 500ms for typical queries
3. **LLM response time**: Varies by model, typically 1-5s
4. **Queue depth**: Monitor pending approval tasks

```bash
# Check pending approvals
medplum get "Task?status=requested&code=http://medplum.com/ai-command"

# Check recent audit events
medplum get "AuditEvent?_sort=-recorded&_count=20"
```

### Database Maintenance

```bash
# Check embedding count
docker exec -it postgres psql -U medplum -d medplum \
  -c "SELECT COUNT(*) FROM clinical_embeddings;"

# Vacuum and analyze
docker exec -it postgres psql -U medplum -d medplum \
  -c "VACUUM ANALYZE clinical_embeddings;"

# Rebuild index if needed
docker exec -it postgres psql -U medplum -d medplum \
  -c "REINDEX INDEX clinical_embeddings_embedding_idx;"
```

---

## Troubleshooting

### Common Issues

#### 1. LLM Router Connection Failed

```
Error: ECONNREFUSED 127.0.0.1:4000
```

**Solution:**
```bash
# Check LLM Router is running
docker compose ps llm-router

# Restart LLM Router
docker compose restart llm-router

# Check logs
docker compose logs llm-router

# Verify endpoints
curl http://localhost:4000/v1/models
```

#### 1b. Ollama Backend Connection Failed (if using Ollama)

```
Error: LLM Router cannot reach Ollama backend
```

**Solution:**
```bash
# Check Ollama is running
docker compose ps ollama

# Restart Ollama
docker compose restart ollama

# Check logs
docker compose logs ollama
```

#### 2. Embedding Dimension Mismatch

```
Error: expected 768 dimensions, got 1536
```

**Solution:** Ensure using `nomic-embed-text` model:
```bash
docker exec -it ollama ollama pull nomic-embed-text
```

#### 3. Bot Execution Timeout

```
Error: Bot execution timed out after 30000ms
```

**Solution:** Increase timeout in Medplum server config or optimize bot code.

#### 4. pgvector Index Issues

```
Error: index "clinical_embeddings_embedding_idx" is invalid
```

**Solution:**
```bash
docker exec -it postgres psql -U medplum -d medplum \
  -c "REINDEX INDEX clinical_embeddings_embedding_idx;"
```

#### 5. LLM Gateway 502 Error

```
Error: 502 Bad Gateway from LLM Gateway
```

**Solution:**
```bash
# Check gateway config
cat config/litellm-config.yaml

# Restart gateway
docker compose restart llm-gateway
```

### Debug Mode

Enable verbose logging:

```bash
# Set environment variable
export DEBUG=medplum:*

# Or in docker-compose.yml
environment:
  - DEBUG=medplum:*
  - LOG_LEVEL=debug
```

### Reset Everything

If needed, completely reset the stack:

```bash
# Stop all services
docker compose down

# Remove volumes (WARNING: deletes all data)
docker compose down -v

# Remove images
docker compose down --rmi all

# Start fresh
docker compose up -d
```

---

## Production Considerations

### Security

1. **Change default passwords** in docker-compose.yml
2. **Enable HTTPS** for all endpoints
3. **Configure proper CORS** settings
4. **Use secrets management** for API keys
5. **Enable audit logging** for all operations

### Scaling

1. **Multiple Ollama instances** for load balancing
2. **Read replicas** for PostgreSQL
3. **Redis Cluster** for high availability
4. **Horizontal pod scaling** in Kubernetes

### Backup

```bash
# Backup PostgreSQL
docker exec postgres pg_dump -U medplum medplum > backup.sql

# Backup Ollama models
docker cp ollama:/root/.ollama ./ollama-backup

# Backup Redis
docker exec redis redis-cli -a medplum BGSAVE
```

---

## Next Steps

After deployment:

1. Run the test suite to verify everything works:
   ```bash
   cd ~/medplum/bots
   npm test
   RUN_E2E=true npm run test:e2e
   ```

2. Create test patient data and verify embedding generation

3. Test the approval workflow with a sample AI command

4. Configure monitoring and alerting

5. Document any environment-specific configurations
