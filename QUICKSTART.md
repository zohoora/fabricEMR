# FabricEMR Quick Start Guide

Get FabricEMR running in 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Docker Desktop** installed and running
- **Node.js 18+** installed
- **LLM Router** with OpenAI-compatible API (routes to backend models):
  - Model alias `clinical-model` (e.g., qwen3:4b) for text generation
  - Model alias `embedding-model` (e.g., nomic-embed-text) for 768-dim embeddings

## Step 1: Start the Services

```bash
cd /path/to/fabricEMR

# Start all Docker services
docker compose up -d

# Wait for healthy status (about 60 seconds)
docker compose ps
```

You should see all services as "healthy":
```
NAME                       STATUS
medplum-llm-gateway-1      Up (healthy)
medplum-medplum-app-1      Up (healthy)
medplum-medplum-server-1   Up (healthy)
medplum-postgres-1         Up (healthy)
medplum-redis-1            Up (healthy)
```

## Step 2: Access the Application

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:8103 |
| LLM Router | http://localhost:4000 |
| LLM Gateway (legacy) | http://localhost:8080 |

**Login credentials:**
- Email: `admin@example.com`
- Password: `medplum`

## Step 3: Verify Bots are Deployed

```bash
# Run the verification script
node verify-deployment.js
```

Expected output:
```
=== DEPLOYED BOTS ===

✓ Embedding Bot
✓ Semantic Search Bot
✓ RAG Pipeline Bot
... (all 9 bots)

=== SUBSCRIPTIONS ===

✓ Embedding - DiagnosticReport
... (all 9 subscriptions)

=== DEPLOYMENT COMPLETE ===
```

## Step 4: Test a Bot

### Get an Auth Token

```bash
# Login
curl -X POST http://localhost:8103/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}'

# Response: {"login":"...","code":"abc123"}

# Exchange code for token
curl -X POST http://localhost:8103/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=abc123&code_verifier=test"

# Response: {"access_token":"eyJ...","token_type":"Bearer",...}
```

### Execute a Bot

```bash
# Test the Semantic Search Bot
curl -X POST "http://localhost:8103/fhir/R4/Bot/e8d04e1d-7309-463b-ba7b-86dda61e3bbe/\$execute" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"diabetes","limit":5}'
```

## Common Tasks

### Stop Services

```bash
docker compose down
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f medplum-server
```

### Restart After Computer Reboot

```bash
docker compose up -d
```

Services will auto-restart if Docker Desktop is configured to start on login.

### Rebuild and Redeploy Bots

After making code changes:

```bash
cd bots
npm run build
cd ..
node deploy-bots.js
```

### Reset Everything

**Warning:** This deletes all data!

```bash
docker compose down -v
docker compose up -d
```

## Troubleshooting

### Services Not Starting

```bash
# Check Docker is running
docker info

# Check for port conflicts
lsof -i :3000
lsof -i :8103
```

### LLM Router Connection Issues

The AI bots communicate with an LLM Router at `http://localhost:4000` by default.

1. Ensure the LLM Router is running and accessible
2. Check the router has required model aliases configured:
   - `clinical-model` for text generation
   - `embedding-model` for embeddings (768-dim)
3. Verify the API key is set correctly in `LLM_API_KEY` in `.env`
4. If the router is on a different machine, update `LLM_ROUTER_URL` in `.env`

### Ollama Backend Issues (if using Ollama with LLM Router)

1. Ensure Ollama is running: `ollama list`
2. Check the models are installed: `ollama pull qwen3:4b && ollama pull nomic-embed-text`
3. Verify the LLM Router is correctly configured to route to Ollama

### Bot Execution Errors

```bash
# Check server logs
docker compose logs medplum-server | grep -i error

# Check bot code is deployed
node verify-deployment.js
```

### Token Expired

Tokens expire after 1 hour. Get a new token using the login flow above.

## Next Steps

1. **Read the Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Explore Bot APIs**: See [bots/docs/API.md](./bots/docs/API.md)
3. **Create Test Data**: Use the Medplum App to create patients and clinical resources
4. **Watch Embeddings**: Create a Condition and check if the Embedding Bot triggers

## File Structure Reference

```
fabricEMR/
├── bots/
│   ├── src/                 # Bot TypeScript source
│   │   └── services/        # Shared services (LLM client)
│   ├── dist/                # Compiled JavaScript
│   ├── docs/                # API and deployment docs
│   └── package.json         # Bot dependencies
├── config/
│   ├── litellm-config.yaml  # LLM routing config (legacy)
│   └── safety-filters.yaml  # AI safety rules
├── docker-compose.yml       # Service definitions
├── deploy-bots.js           # Bot deployment script
├── create-subscriptions.js  # Subscription setup
├── verify-deployment.js     # Deployment verification
├── README.md                # Main documentation
├── ARCHITECTURE.md          # System design
├── CURRENT_STATUS.md        # Project status
└── QUICKSTART.md            # This file
```

## Getting Help

- Check [CURRENT_STATUS.md](./CURRENT_STATUS.md) for known issues
- Review bot source code in `bots/src/`
- Check Docker logs for errors
