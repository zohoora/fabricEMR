# FabricEMR Quick Start Guide

Get FabricEMR running in 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Docker** via one of:
  - **Colima** (recommended for macOS) - lightweight Docker runtime
  - **Docker Desktop** - full GUI application
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
| LLM Router | http://10.241.15.154:8000 |

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

Services will auto-restart if your Docker runtime is configured to start on login.

## Server Management

### Check Server Status

```bash
# Check Docker runtime (Colima)
colima status

# Check Medplum containers
docker ps | grep medplum

# Quick health check (all-in-one)
colima status && docker ps | grep medplum
```

### Colima Commands (Docker Runtime)

```bash
colima status              # Check if Colima is running
colima start               # Start Colima manually
colima stop                # Stop Colima
brew services list | grep colima   # Check auto-start status
```

### Docker Container Commands

```bash
docker ps                  # List running containers
docker ps -a               # List all containers (including stopped)
docker logs <container>    # View container logs
docker restart <container> # Restart a container
```

### Medplum-Specific Commands

```bash
docker logs fabricemr-medplum-server-1            # View server logs
docker logs fabricemr-medplum-server-1 --tail 50  # Last 50 lines
docker restart fabricemr-medplum-server-1         # Restart server
```

### Enable Auto-Start on Reboot

To ensure FabricEMR starts automatically after a reboot:

**For Colima users (macOS):**
```bash
brew services start colima
```

This registers Colima as a LaunchAgent. The Medplum containers have `restart: always` policy, so they'll start automatically once Colima is running.

**For Docker Desktop users:**
1. Open Docker Desktop
2. Go to Settings → General
3. Enable "Start Docker Desktop when you sign in"

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

The AI bots communicate with an LLM Router at `http://10.241.15.154:8000`.

1. Ensure the LLM Router is running: `curl http://10.241.15.154:8000/health`
2. Check the router has required model aliases configured:
   - `clinical-model` for text generation
   - `embedding-model` for embeddings (768-dim)
3. Verify the API key: `fabric-emr-secret-key`
4. If the router URL changes, update `LLM_ROUTER_URL` in `bots/src/services/llm-client.ts`

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
