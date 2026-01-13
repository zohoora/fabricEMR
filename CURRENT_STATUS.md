# FabricEMR Current Status

Last updated: 2025-01-13

## Quick Start for New AI Assistants

```bash
# Check if services are running
docker ps

# If not running, start everything
./start-server.sh

# Verify health
curl http://localhost:8103/healthcheck
```

## Server Access

### Local Access
- API: `http://localhost:8103`
- Web UI: `http://localhost:3000`

### LLM Router (External)
- URL: `http://10.241.15.154:8000`
- API Key: `fabric-emr-secret-key`
- Client ID: `fabric-emr`

## Authentication

### Admin Credentials
```
Email:    admin@example.com
Password: medplum
```

### Registered OAuth Clients

| App | Client ID | Redirect URI |
|-----|-----------|--------------|
| FabricScribe | `af1464aa-e00c-4940-a32e-18d878b7911c` | `fabricscribe://oauth/callback` |
| Stitches EMR | `c2b35339-4ac0-43f5-86ec-270a4743d59a` | `fabricscribe://oauth/callback` |

### Getting an API Token
```bash
# Login
CODE=$(curl -s -X POST http://localhost:8103/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}' \
  | jq -r '.code')

# Exchange for token
curl -s -X POST http://localhost:8103/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=$CODE&code_verifier=test" > /tmp/token.json
```

## What's Running (Docker)

All services healthy:
- `fabricemr-medplum-server-1` (port 8103) - FHIR R4 API
- `fabricemr-medplum-app-1` (port 3000) - OAuth login UI
- `fabricemr-postgres-1` (port 5432) - Database with pgvector
- `fabricemr-redis-1` (port 6379) - Cache
- `fabricemr-llm-gateway-1` (port 8080) - LiteLLM proxy (legacy, not actively used)

### Docker Commands
```bash
# Start all services
./start-server.sh

# Or manually
docker compose up -d

# Check status
docker ps

# View logs
docker compose logs -f medplum-server

# Stop
docker compose down
```

## Deployed Bots (9 total)

| Bot | ID | Trigger |
|-----|-----|---------|
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` | DiagnosticReport, DocumentReference, Observation, Condition, MedicationStatement |
| Semantic Search Bot | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | API invoked |
| RAG Pipeline Bot | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | API invoked |
| Command Processor Bot | `87780e52-abc5-4122-8225-07e74aaf18ca` | API invoked |
| Approval Queue Bot | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Task with ai-command code |
| Clinical Decision Support Bot | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | Encounter, MedicationRequest |
| Documentation Assistant Bot | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | API invoked |
| Billing Code Suggester Bot | `093a0c9d-44ea-4672-8208-d1d199962f33` | Encounter?status=finished |
| Audit Logging Bot | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | API invoked |

## Active Subscriptions (9 total)

- Embedding triggers for 5 clinical resource types
- CDS triggers for Encounter and MedicationRequest
- Billing trigger for finished Encounters
- Approval Queue trigger for ai-command Tasks

## LLM Router Configuration

### Connection Details
- **URL**: `http://10.241.15.154:8000`
- **API Key**: `fabric-emr-secret-key`
- **Client ID**: `fabric-emr`

### Required Headers
All requests to the LLM Router must include:
```
Authorization: Bearer fabric-emr-secret-key
X-Client-Id: fabric-emr
X-Clinic-Task: <task_name>
Content-Type: application/json
```

### Available Tasks
| Task | Use Case |
|------|----------|
| `embedding` | Generate text embeddings |
| `semantic_search` | Semantic similarity queries |
| `rag_query` | RAG-based question answering |
| `clinical_decision` | Clinical decision support |
| `documentation` | Documentation generation |
| `billing_codes` | Billing code suggestions |

### Available Models
- `clinical-model` - Text generation (Qwen3-4B)
- `fast-model` - Quick responses
- `embedding-model` - 768-dim embeddings (ModernBERT)
- `soap-model` - SOAP note generation
- `ocr-model` - OCR tasks

### Endpoints
- `/v1/chat/completions` - Text generation
- `/v1/embeddings` - Embedding generation
- `/v1/models` - List available models
- `/health` - Health check

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `start-server.sh` | Start all services (handles Colima, Docker, medplum-app) |
| `deploy-bots.js` | Deploy bot code to Medplum |
| `create-subscriptions.js` | Create FHIR subscriptions |
| `verify-deployment.js` | Verify bot deployment status |

## Documentation Files

| File | Description |
|------|-------------|
| `README.md` | Project overview |
| `ARCHITECTURE.md` | System design, data flows, security |
| `QUICKSTART.md` | 5-minute getting started guide |
| `CURRENT_STATUS.md` | This file - current deployment state |
| `EMR_FRONTEND_INTEGRATION.md` | Frontend integration guide (OAuth, FHIR API, Bots, LLM) |
| `SCRIBE_INTEGRATION.md` | AI scribe app integration docs |
| `bots/README.md` | Bot documentation |
| `bots/docs/DEPLOYMENT.md` | Bot deployment guide |
| `bots/docs/API.md` | Bot API reference |

## Known Issues / Workarounds

1. **medplum-app Docker image** - Permission issues on ARM Macs. Fixed by extracting static files and serving via nginx:alpine.

2. **Mac sleep with lid closed** - Run `sudo pmset -c disablesleep 1` to keep server running when lid is closed.

3. **Token expiry** - Auth tokens expire after 1 hour. Re-run the login flow to get a new token.

## Invoking API Bots

```bash
TOKEN=$(cat /tmp/token.json | jq -r '.access_token')

curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "search query here"}'
```
