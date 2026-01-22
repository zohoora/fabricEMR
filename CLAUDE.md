# CLAUDE.md - FabricEMR

Project context for Claude Code sessions.

## What is this?

AI-native healthcare platform built on Medplum (FHIR R4). Features semantic search, RAG, clinical decision support, and 9 AI bots. All PHI stays local.

## Quick Commands

```bash
# Start everything
./start-server.sh

# Check status
docker compose ps

# Restart after config changes
docker compose restart medplum-server medplum-app

# Deploy bots after code changes
cd bots && npm run build && cd .. && node deploy-bots.js

# Run tests
cd bots && npm test

# Update network config for external access
./update-network-config.sh ip      # Use machine IP
./update-network-config.sh         # Use hostname.local
```

## Services & Ports

| Service | Port | Purpose |
|---------|------|---------|
| medplum-server | 8103 | FHIR R4 API, OAuth, bot runtime |
| medplum-app | 3000 | Web UI (login, admin) |
| postgres | 5432 | FHIR data + pgvector embeddings |
| redis | 6379 | Cache, queues |
| llm-gateway | 8080 | LiteLLM (legacy, optional) |
| LLM Router | 10.241.15.154:8080 | External - routes to backend LLMs |

## Network Configuration

**Critical for external access (scribe apps, remote clients):**

The server defaults to `localhost` URLs which breaks OAuth for remote clients. To fix:

1. Run `./update-network-config.sh ip` - updates both `medplum.config.json` AND `.env`
2. Restart: `docker compose restart medplum-server medplum-app`

Config files that matter:
- `.env` - Docker Compose environment (takes precedence)
- `medplum.config.json` - Server config (fallback)
- `config/medplum-app-nginx.conf` - App caching settings

Key variables:
```
MEDPLUM_BASE_URL=http://<IP>:8103/
MEDPLUM_APP_BASE_URL=http://<IP>:3000/
```

## Authentication

**Admin:** `admin@example.com` / `medplum`

**OAuth Clients:**
| App | Client ID |
|-----|-----------|
| FabricEMR Frontend | `c643cd48-e130-4b12-bc0d-80b0ac9f5dc4` |
| FabricScribe | `af1464aa-e00c-4940-a32e-18d878b7911c` |
| Stitches EMR | `c2b35339-4ac0-43f5-86ec-270a4743d59a` |

**Get API token:**
```bash
CODE=$(curl -s -X POST http://localhost:8103/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}' \
  | jq -r '.code')

TOKEN=$(curl -s -X POST http://localhost:8103/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=$CODE&code_verifier=test" \
  | jq -r '.access_token')
```

## LLM Router Integration

All AI bots use the LLM Router (not local Ollama).

**Connection:**
- URL: `http://10.241.15.154:8080`
- API Key: `fabric-emr-secret-key`
- Client ID: `fabric-emr`

**Required headers:**
```
Authorization: Bearer fabric-emr-secret-key
X-Client-Id: fabric-emr
X-Clinic-Task: <task_name>
```

**Models:**
- `clinical-model` - Text generation
- `embedding-model` - 768-dim embeddings
- `fast-model` - Quick responses

**Endpoints:**
- `/v1/chat/completions` - Chat
- `/v1/embeddings` - Embeddings
- `/v1/models` - List models

## Project Structure

```
fabricEMR/
├── bots/                   # AI Bot source (TypeScript)
│   ├── src/               # Source files
│   │   └── services/      # Shared LLM client
│   └── dist/              # Compiled JS (deployed to Medplum)
├── config/                # Config files
│   ├── litellm-config.yaml
│   ├── medplum-app-nginx.conf
│   └── postgres-init.sql
├── mcp-server/            # MCP server for IT admin
├── docker-compose.yml     # Service orchestration
├── medplum.config.json    # Medplum server config
├── .env                   # Environment variables
├── deploy-bots.js         # Bot deployment
├── create-subscriptions.js
├── verify-deployment.js
├── start-server.sh        # Start script (Colima + Docker)
└── update-network-config.sh  # Network URL updater
```

## AI Bots (9 deployed)

| Bot | Trigger | Purpose |
|-----|---------|---------|
| Embedding Bot | Auto: clinical resources | Generate vector embeddings |
| Semantic Search Bot | API | Vector similarity search |
| RAG Pipeline Bot | API | Clinical Q&A with context |
| Command Processor Bot | API | Validate AI commands |
| Approval Queue Bot | Auto: Task | Human approval workflow |
| Clinical Decision Support | Auto: Encounter, MedRequest | Diagnosis, drug interactions |
| Documentation Assistant | API | Generate clinical notes |
| Billing Code Suggester | Auto: Encounter finished | CPT/ICD-10 suggestions |
| Audit Logging Bot | API | AI audit trail |

**Invoke API bot:**
```bash
curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "search query"}'
```

## Common Issues & Fixes

### OAuth redirect to localhost
**Symptom:** Remote clients can't complete OAuth - redirect goes to `localhost:3000`
**Fix:** Run `./update-network-config.sh ip` and restart services

### Browser caching old JS
**Symptom:** OAuth still fails after config fix, console shows `localhost:8103` errors
**Fix:** Clear browser cache, hard refresh (Ctrl+Shift+R)

### medplum-app won't start (permission denied)
**Symptom:** Container fails with `/docker-entrypoint.sh: permission denied`
**Fix:** Pull fresh image: `docker pull medplum/medplum-app:latest`

### Mac sleep with lid closed
**Fix:** `sudo pmset -c disablesleep 1`

### Token expired
**Symptom:** 401 errors after ~1 hour
**Fix:** Re-run login flow to get new token

## Testing

```bash
cd bots
npm test                      # Unit tests
npm run test:integration      # Integration tests
RUN_E2E=true npm run test:e2e # E2E tests (requires running server)
```

## Documentation

| Doc | Purpose |
|-----|---------|
| README.md | Project overview |
| ARCHITECTURE.md | System design, data flows |
| CURRENT_STATUS.md | Deployment state, bot IDs |
| SCRIBE_INTEGRATION.md | AI scribe app integration |
| EMR_FRONTEND_INTEGRATION.md | Frontend OAuth/API guide |
| bots/README.md | Bot documentation |
| bots/docs/API.md | Bot API reference |

## Claude Code Extensions

### Hooks (`.claude/settings.json`)
- **PostToolUse (Edit|Write):** Auto-lint TypeScript files with ESLint
- **PreToolUse (Edit|Write):** Block direct `.env` edits (use `update-network-config.sh` instead)

### Custom Agents (`.claude/agents/`)
- **security-reviewer** - HIPAA/PHI security review for healthcare code

### Custom Commands (`.claude/commands/`)
- `/test` - Run bot tests (`/test unit`, `/test integration`, `/test e2e`, `/test coverage`)
