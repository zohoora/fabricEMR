# Medplum AI Bots Deployment Guide

Complete guide for deploying the AI-native Medplum stack with all bots and services.

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

### macOS with Apple Silicon

```bash
# Install Colima for Docker
brew install colima docker docker-compose

# Start Colima with sufficient resources
colima start --cpu 4 --memory 8 --disk 100

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

### 3. Initialize Ollama Models

```bash
# Pull required models
docker exec -it ollama ollama pull llama3.2:3b
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

### 2. Create Medplum Bot Resources

Using Medplum CLI or API, create Bot resources for each bot:

```bash
# Install Medplum CLI if not already
npm install -g @medplum/cli

# Login to Medplum
medplum login

# Create bots (repeat for each bot)
medplum bot create embedding-bot
medplum bot create semantic-search-bot
medplum bot create rag-pipeline-bot
medplum bot create command-processor-bot
medplum bot create approval-queue-bot
medplum bot create clinical-decision-support-bot
medplum bot create documentation-assistant-bot
medplum bot create billing-code-suggester-bot
medplum bot create audit-logging-bot
```

### 3. Deploy Bot Code

```bash
# Deploy each bot
medplum bot deploy embedding-bot dist/embedding-bot.js
medplum bot deploy semantic-search-bot dist/semantic-search-bot.js
medplum bot deploy rag-pipeline-bot dist/rag-pipeline-bot.js
medplum bot deploy command-processor-bot dist/command-processor-bot.js
medplum bot deploy approval-queue-bot dist/approval-queue-bot.js
medplum bot deploy clinical-decision-support-bot dist/clinical-decision-support-bot.js
medplum bot deploy documentation-assistant-bot dist/documentation-assistant-bot.js
medplum bot deploy billing-code-suggester-bot dist/billing-code-suggester-bot.js
medplum bot deploy audit-logging-bot dist/audit-logging-bot.js
```

Or use the convenience script:

```bash
npm run deploy
```

---

## Subscription Configuration

Create Medplum Subscriptions to trigger bots automatically.

### 1. Embedding Bot Subscription

Trigger on clinical resource changes:

```json
{
  "resourceType": "Subscription",
  "status": "active",
  "reason": "Trigger embedding generation for clinical resources",
  "criteria": "DiagnosticReport?_lastUpdated=gt2024-01-01",
  "channel": {
    "type": "rest-hook",
    "endpoint": "Bot/embedding-bot"
  }
}
```

Create subscriptions for each resource type:

```bash
# DiagnosticReport
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "DiagnosticReport?",
  "channel": {"type": "rest-hook", "endpoint": "Bot/embedding-bot"}
}'

# Condition
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Condition?",
  "channel": {"type": "rest-hook", "endpoint": "Bot/embedding-bot"}
}'

# Observation
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Observation?",
  "channel": {"type": "rest-hook", "endpoint": "Bot/embedding-bot"}
}'

# DocumentReference
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "DocumentReference?",
  "channel": {"type": "rest-hook", "endpoint": "Bot/embedding-bot"}
}'
```

### 2. Approval Queue Subscription

Trigger when Task status changes:

```bash
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Task?code=http://medplum.com/ai-command|*",
  "channel": {"type": "rest-hook", "endpoint": "Bot/approval-queue-bot"}
}'
```

### 3. CDS Subscription (Optional)

Trigger CDS analysis on new encounters:

```bash
medplum post Subscription '{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Encounter?status=in-progress",
  "channel": {"type": "rest-hook", "endpoint": "Bot/clinical-decision-support-bot"}
}'
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check all services
docker compose ps

# Check Medplum server
curl http://localhost:8103/healthcheck

# Check Ollama
curl http://localhost:11434/api/tags

# Check LLM Gateway
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

#### 1. Ollama Connection Failed

```
Error: ECONNREFUSED 127.0.0.1:11434
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
