# FabricEMR Current Status

Last updated: 2026-01-06

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
- LLM Gateway: `http://localhost:8080`

### Network Access (for other machines/apps)
- Hostname: `Arashs-MacBook-Pro.local`
- API: `http://Arashs-MacBook-Pro.local:8103`
- Web UI: `http://Arashs-MacBook-Pro.local:3000`
- LLM Gateway: `http://Arashs-MacBook-Pro.local:8080`

See `EMR_FRONTEND_INTEGRATION.md` for complete frontend integration docs.

## Authentication

### Admin Credentials
```
Email:    admin@example.com
Password: medplum123
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
  -d '{"email":"admin@example.com","password":"medplum123","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}' \
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
- `fabricemr-llm-gateway-1` (port 8080) - LiteLLM proxy

**Note:** The medplum-app container uses a custom nginx setup due to Docker image compatibility issues on ARM Macs. A pre-configured image `fabricemr-medplum-app-configured` has been saved.

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

## LLM Configuration

### LiteLLM Gateway
- URL: `http://localhost:8080`
- API Key: `sk-medplum-ai`

### Available Models (Ollama)
- `ollama/nomic-embed-text` - Embeddings (768 dim)
- `ollama/qwen3:4b` - Chat/completion

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `start-server.sh` | Start all services (handles Colima, Docker, medplum-app) |
| `update-network-config.sh` | Update config for hostname or IP changes |
| `deploy-bots.js` | Deploy bot code to Medplum |
| `create-subscriptions.js` | Create FHIR subscriptions |
| `verify-deployment.js` | Verify bot deployment status |

## Documentation Files

| File | Description |
|------|-------------|
| `README.md` | Project overview |
| `ARCHITECTURE.md` | System design, data flows, security |
| `QUICKSTART.md` | 5-minute getting started guide |
| `AI_SETUP_GUIDE.md` | Complete AI development environment setup |
| `CURRENT_STATUS.md` | This file - current deployment state |
| `EMR_FRONTEND_INTEGRATION.md` | **Frontend integration guide** (OAuth, FHIR API, Bots, LLM) |
| `NETWORK_ACCESS.md` | Network access summary |
| `SCRIBE_INTEGRATION.md` | AI scribe app integration docs |
| `FLUTTER_FRONTEND_PROMPT.md` | Frontend planning |
| `bots/README.md` | Bot documentation |
| `bots/docs/DEPLOYMENT.md` | Bot deployment guide |
| `bots/docs/API.md` | Bot API reference |

## Known Issues / Workarounds

1. **medplum-app Docker image** - Permission issues on ARM Macs. Fixed by extracting static files and serving via nginx:alpine. Pre-configured image saved as `fabricemr-medplum-app-configured`.

2. **Mac sleep with lid closed** - Run `sudo pmset -c disablesleep 1` to keep server running when lid is closed.

3. **Network changes** - When moving to a new network, hostname `Arashs-MacBook-Pro.local` should auto-resolve via mDNS. If not, run:
   ```bash
   ./update-network-config.sh ip
   docker compose restart medplum-server
   ```

## Still Pending

- AccessPolicy for roles
- Error handling standardization
- HIPAA compliance documentation
- Integration testing with Ollama/LiteLLM
- Whisper server auto-start (currently manual)

## Invoking API Bots

```bash
TOKEN=$(cat /tmp/token.json | jq -r '.access_token')

curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "search query here"}'
```
