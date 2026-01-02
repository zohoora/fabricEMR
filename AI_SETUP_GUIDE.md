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
| Ollama API | http://localhost:11434 | LLM API |
| LLM Gateway | http://localhost:8080 | Proxy (optional) |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Cache |

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
│   │   ├── mocks/          # Mock implementations
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

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=qwen3:4b
EMBEDDING_MODEL=nomic-embed-text

# Testing
RUN_E2E=true  # Enable E2E tests
```

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
# All 5 services should be "healthy"

# 2. Check Medplum API
curl http://localhost:8103/healthcheck
# Should return "OK"

# 3. Check Ollama
curl http://localhost:11434/api/tags
# Should list models

# 4. Run unit tests
cd bots && npm test
# Should show 191 tests passing

# 5. Run Ollama E2E tests
RUN_E2E=true npm test -- --testNamePattern="Ollama"
# Should show 2 tests passing

# 6. Access Medplum UI
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

3. **Ollama models are required** - Both `nomic-embed-text` and `qwen3:4b` must be pulled

4. **Clinical Workflow E2E tests** - These require valid Medplum client credentials which may need manual setup through the Medplum UI

5. **The bots use dependency injection** - Tests use mocks in `tests/mocks/` directory

6. **TypeScript strict mode** - The project uses strict TypeScript, ensure types are correct

7. **FHIR compliance** - All resources follow FHIR R4 specification

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
```

---

**Document Version:** 1.0
**Last Updated:** January 2, 2026
**Repository:** https://github.com/zohoora/fabricEMR
