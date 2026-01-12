# AI Setup Guide for FabricEMR

**Purpose**: This document provides complete instructions for an AI assistant to set up and run the FabricEMR project on a new computer. Follow these steps exactly.

---

## Project Overview

FabricEMR is a Medplum-based healthcare platform with AI-powered clinical bots. The system consists of:

- **Medplum Server**: FHIR-compliant healthcare data platform (Docker)
- **Medplum App**: Web UI for Medplum (Docker)
- **PostgreSQL**: Database for Medplum (Docker)
- **Redis**: Cache for Medplum (Docker)
- **Ollama**: Local LLM server for AI features (native install)
- **AI Bots**: TypeScript bots in `/bots` directory

---

## Prerequisites Check

Before starting, verify these are installed:

```bash
# Check Docker
docker --version
# Expected: Docker version 20.x or higher

# Check Node.js
node --version
# Expected: v18.x or higher (v22 recommended)

# Check npm
npm --version
# Expected: 9.x or higher

# Check git
git --version
# Expected: git version 2.x
```

### Install Missing Prerequisites

**macOS:**
```bash
# Install Homebrew if not present
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Docker (choose one)
brew install --cask docker          # Docker Desktop
# OR
brew install colima docker docker-compose  # Colima (lighter weight)

# Install Node.js
brew install node@22

# Install Ollama
brew install ollama
```

**Linux (Ubuntu/Debian):**
```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
- Docker Desktop: https://www.docker.com/products/docker-desktop
- Node.js: https://nodejs.org/en/download/
- Ollama: https://ollama.com/download

---

## Step-by-Step Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/zohoora/fabricEMR.git
cd fabricEMR
```

### Step 2: Start Docker Services

**If using Colima (macOS):**
```bash
colima start
```

**Start all services:**
```bash
docker compose up -d
```

**Verify services are running:**
```bash
docker ps
```

Expected output should show 5 containers:
- `medplum-postgres-1`
- `medplum-redis-1`
- `medplum-medplum-server-1`
- `medplum-medplum-app-1`
- `medplum-llm-gateway-1`

**Wait for health checks:**
```bash
# Wait ~30 seconds, then verify
docker compose ps
# All should show "healthy" status
```

### Step 3: Set Up Ollama Models

**Start Ollama service:**
```bash
# macOS/Linux
ollama serve &
# Or it may already be running as a service
```

**Pull required models:**
```bash
# Embedding model (required)
ollama pull nomic-embed-text

# LLM model (required)
ollama pull qwen3:4b
```

**Verify models:**
```bash
ollama list
# Should show:
# nomic-embed-text
# qwen3:4b
```

### Step 4: Install Bot Dependencies

```bash
cd bots
npm install
```

### Step 5: Run Tests to Verify Setup

```bash
# Run all unit and integration tests
npm test

# Expected output:
# Test Suites: 11 passed, 11 total
# Tests: 191 passed, 191 total
```

**Run Ollama E2E tests:**
```bash
RUN_E2E=true npm test -- --testNamePattern="Ollama Integration"

# Expected: 2 passed
```

---

## Service URLs

Once running, services are available at:

| Service | URL | Purpose |
|---------|-----|---------|
| Medplum App | http://localhost:3000 | Web UI |
| Medplum API | http://localhost:8103 | FHIR API |
| **RouterLLM** | **http://Arashs-MacBook-Pro.local:8080** | **OpenAI-compatible LLM API** |
| Ollama API | http://localhost:11434 | Direct Ollama access (if needed) |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Cache |

### RouterLLM Configuration

The AI bots connect to RouterLLM using these credentials:

| Setting | Value |
|---------|-------|
| Router URL | `http://Arashs-MacBook-Pro.local:8080` |
| API Key | `fabric-emr-key` |
| Client ID | `fabric-emr` |

**Available Models:**
- `clinical-model` - Clinical decisions, documentation
- `fast-model` - Quick responses, general queries
- `embedding-model` - Text embeddings for RAG
- `nomic-embed-text` - Alternative embedding model

---

## Default Credentials

**Medplum Admin:**
- Email: `admin@example.com`
- Password: `medplum`
- Project ID: `d0917cd3-0f34-431b-85eb-d18162f7d4ea`

---

## Directory Structure

```
fabricEMR/
├── docker-compose.yml      # Docker services configuration
├── config/
│   └── postgres-init.sql   # Database initialization
├── bots/                   # AI bots directory
│   ├── src/                # Bot source code
│   │   ├── services/       # Shared services
│   │   │   └── llm-client.ts  # OpenAI-compatible LLM client
│   │   ├── embedding-bot.ts
│   │   ├── semantic-search-bot.ts
│   │   ├── rag-pipeline-bot.ts
│   │   ├── clinical-decision-support-bot.ts
│   │   ├── command-processor-bot.ts
│   │   ├── approval-queue-bot.ts
│   │   ├── billing-code-suggester-bot.ts
│   │   ├── documentation-assistant-bot.ts
│   │   └── audit-logging-bot.ts
│   ├── tests/              # Test files
│   │   ├── unit/           # Unit tests
│   │   ├── integration/    # Integration tests
│   │   ├── e2e/            # End-to-end tests
│   │   ├── mocks/          # Mock implementations (OpenAI-compatible)
│   │   └── fixtures/       # Test data
│   ├── package.json
│   └── tsconfig.json
├── deploy-bots.js          # Bot deployment script
├── create-subscriptions.js # Subscription setup script
└── verify-deployment.js    # Deployment verification
```

---

## Environment Variables

The bots support these environment variables:

```bash
# Medplum
MEDPLUM_BASE_URL=http://localhost:8103
MEDPLUM_CLIENT_ID=<client-application-id>
MEDPLUM_CLIENT_SECRET=<client-secret>

# LLM Router (OpenAI-compatible API)
LLM_ROUTER_URL=http://Arashs-MacBook-Pro.local:8080        # RouterLLM endpoint
LLM_API_KEY=fabric-emr-key                  # Authentication key
LLM_CLIENT_ID=fabric-emr                    # Client identifier for tracking

# Model Aliases (configured in LLM Router)
CLINICAL_MODEL=clinical-model               # For text generation
FAST_MODEL=fast-model                       # For quick responses
EMBEDDING_MODEL=embedding-model             # For embeddings (maps to nomic-embed-text)

# Legacy (fallback if LLM_ROUTER_URL not set)
OLLAMA_API_BASE=http://localhost:11434

# Testing
RUN_E2E=true  # Enable E2E tests
```

### LLM Router Integration

The bots use a shared LLM client (`src/services/llm-client.ts`) that communicates with an OpenAI-compatible LLM Router. This provides:

- **Unified API**: All LLM calls use OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/embeddings`)
- **Request Tracking**: Headers include `X-Client-Id`, `X-Clinic-Task`, `X-Bot-Name`, `X-Patient-Id`
- **Model Abstraction**: Use model aliases (`clinical-model`, `embedding-model`) instead of specific model names
- **Centralized Configuration**: LLM routing, rate limiting, and logging handled by the router

---

## Common Issues and Solutions

### Issue: Docker containers won't start

**Symptom:** `docker compose up` fails or containers exit immediately

**Solution:**
```bash
# Check if ports are in use
lsof -i :3000
lsof -i :8103
lsof -i :5432

# Kill conflicting processes or change ports in docker-compose.yml

# Reset Docker state
docker compose down -v
docker compose up -d
```

### Issue: "Cannot connect to Docker daemon"

**Symptom:** Docker commands fail with connection error

**Solution (macOS with Colima):**
```bash
colima stop
colima start
```

**Solution (Docker Desktop):**
- Ensure Docker Desktop is running
- Check Docker Desktop settings

### Issue: Ollama model not found

**Symptom:** Tests fail with "model not found" error

**Solution:**
```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Pull missing models
ollama pull nomic-embed-text
ollama pull qwen3:4b
```

### Issue: Tests fail during "quiet hours"

**Symptom:** Command processor tests fail between 10 PM - 6 AM

**Explanation:** The command processor has a quiet hours feature that queues non-urgent commands at night. Tests mock the time to avoid this.

**Solution:** Tests already handle this with:
```typescript
jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);
```

### Issue: Port 3000 conflict

**Symptom:** Medplum app won't start, port already in use

**Solution:**
```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change the port in docker-compose.yml
```

### Issue: npm install fails

**Symptom:** Dependencies fail to install

**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## Verifying Everything Works

Run this sequence to verify complete setup:

```bash
# 1. Check Docker services
docker compose ps
# All services should be "healthy"

# 2. Check Medplum API
curl http://localhost:8103/healthcheck
# Should return "OK"

# 3. Check RouterLLM
curl -s http://Arashs-MacBook-Pro.local:8080/health
# Should return: {"status":"ok"}

# 4. Check RouterLLM models
curl -s http://Arashs-MacBook-Pro.local:8080/v1/models \
  -H "Authorization: Bearer fabric-emr-key" \
  -H "X-Client-Id: fabric-emr"
# Should list available models including clinical-model, embedding-model

# 5. Check Ollama (if running separately)
curl http://localhost:11434/api/tags
# Should list models

# 6. Run unit tests
cd bots && npm test
# Should show 212+ tests passing

# 7. Run RouterLLM integration tests
npm test -- --testPathPattern=llm-router.integration
# Should show 21 tests passing

# 8. Access Medplum UI
# Open http://localhost:3000 in browser
# Login with admin@example.com / medplum
```

---

## Bot Descriptions

| Bot | Purpose | Trigger |
|-----|---------|---------|
| `embedding-bot` | Generate vector embeddings for FHIR resources | Resource create/update |
| `semantic-search-bot` | Find similar resources using embeddings | On-demand query |
| `rag-pipeline-bot` | Answer questions using retrieved context | On-demand query |
| `clinical-decision-support-bot` | Generate clinical alerts and recommendations | Patient data changes |
| `command-processor-bot` | Process AI commands with safety filters | AI command submission |
| `approval-queue-bot` | Handle human approval workflow | Task status changes |
| `billing-code-suggester-bot` | Suggest CPT/ICD-10 codes | Encounter completion |
| `documentation-assistant-bot` | Help with clinical documentation | On-demand |
| `audit-logging-bot` | Create audit trail for AI actions | All bot actions |

---

## Test Commands Reference

```bash
# All tests
npm test

# Specific test file
npm test -- tests/unit/embedding-bot.test.ts

# Tests matching pattern
npm test -- --testNamePattern="safety"

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage

# E2E tests (requires services running)
RUN_E2E=true npm test -- tests/e2e
```

---

## Stopping Services

```bash
# Stop Docker services (keep data)
docker compose stop

# Stop and remove containers (keep data volumes)
docker compose down

# Stop and remove everything including data
docker compose down -v

# Stop Colima (macOS)
colima stop
```

---

## Restarting After Reboot

```bash
# 1. Start Docker
colima start  # macOS with Colima
# OR start Docker Desktop

# 2. Start services
cd fabricEMR
docker compose up -d

# 3. Start Ollama (if not auto-starting)
ollama serve &

# 4. Verify
docker compose ps
curl http://localhost:8103/healthcheck
```

---

## Additional Notes for AI Assistants

1. **The tests are the source of truth** - If tests pass, the implementation is correct

2. **Mock time for testing** - Tests mock `Date.prototype.getHours` to avoid quiet hours issues

3. **LLM Router is required** - The bots communicate via OpenAI-compatible API to an LLM Router (which routes to Ollama or other backends)

4. **Model aliases** - Use `clinical-model` and `embedding-model` aliases, not specific model names like `qwen3:4b`

5. **Shared LLM client** - All LLM interactions go through `src/services/llm-client.ts` which handles:
   - OpenAI-compatible API format (`/v1/chat/completions`, `/v1/embeddings`)
   - Request headers for tracking (`X-Client-Id`, `X-Clinic-Task`, etc.)
   - Prompt-to-messages conversion via `splitPromptToMessages()`

6. **Clinical Workflow E2E tests** - These require valid Medplum client credentials which may need manual setup through the Medplum UI

7. **The bots use dependency injection** - Tests use mocks in `tests/mocks/` directory (supports both OpenAI and legacy Ollama formats)

8. **TypeScript strict mode** - The project uses strict TypeScript, ensure types are correct

9. **FHIR compliance** - All resources follow FHIR R4 specification

---

## Quick Validation Script

Save and run this script to validate the setup:

```bash
#!/bin/bash
echo "=== FabricEMR Setup Validation ==="

echo -n "Docker: "
docker --version > /dev/null 2>&1 && echo "OK" || echo "MISSING"

echo -n "Node.js: "
node --version > /dev/null 2>&1 && echo "OK ($(node --version))" || echo "MISSING"

echo -n "RouterLLM: "
curl -s http://Arashs-MacBook-Pro.local:8080/health | grep -q "ok" && echo "OK" || echo "NOT RUNNING"

echo -n "RouterLLM Models: "
curl -s http://Arashs-MacBook-Pro.local:8080/v1/models -H "Authorization: Bearer fabric-emr-key" -H "X-Client-Id: fabric-emr" | grep -q "clinical-model" && echo "OK" || echo "MODELS NOT AVAILABLE"

echo -n "Ollama: "
curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && echo "OK" || echo "NOT RUNNING"

echo -n "Medplum API: "
curl -s http://localhost:8103/healthcheck > /dev/null 2>&1 && echo "OK" || echo "NOT RUNNING"

echo -n "Medplum App: "
curl -s http://localhost:3000 > /dev/null 2>&1 && echo "OK" || echo "NOT RUNNING"

echo -n "PostgreSQL: "
docker exec medplum-postgres-1 pg_isready > /dev/null 2>&1 && echo "OK" || echo "NOT RUNNING"

echo ""
echo "Run 'cd bots && npm test' to verify bot implementation"
echo "Run 'cd bots && npm test -- --testPathPattern=llm-router' for RouterLLM tests"
```

---

**Document Version:** 2.0
**Last Updated:** January 12, 2026
**Repository:** https://github.com/zohoora/fabricEMR

**Changelog:**
- v2.0 (Jan 12, 2026): Updated for LLM Router migration (OpenAI-compatible API)
- v1.0 (Jan 2, 2026): Initial version
