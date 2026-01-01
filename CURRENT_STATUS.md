# FabricEMR Current Status

Last updated: 2026-01-01

## What's Running (Docker)

All services healthy:
- medplum-server (port 8103)
- medplum-app (port 3000)
- postgres (port 5432)
- redis (port 6379)
- llm-gateway (port 8080)

Start: `docker compose up -d`
Stop: `docker compose down`
Logs: `docker compose logs -f`

## What's Implemented

### Bot Code (in /bots/src/)
All 9 bots fully written:
1. embedding-bot.ts
2. semantic-search-bot.ts
3. rag-pipeline-bot.ts
4. command-processor-bot.ts
5. approval-queue-bot.ts
6. clinical-decision-support-bot.ts
7. documentation-assistant-bot.ts
8. billing-code-suggester-bot.ts
9. audit-logging-bot.ts

### Config Files
- config/litellm-config.yaml (LLM routing)
- config/safety-filters.yaml (AI safety rules)
- config/postgres-init.sql (pgvector setup)

### Documentation
- README.md (project overview)
- SCRIBE_INTEGRATION.md (AI scribe app docs)
- FLUTTER_FRONTEND_PROMPT.md (frontend planning)

## NOT YET DONE

### Critical: Bot Deployment
Bots are written but NOT registered in Medplum.
Next session should:
1. Get auth token from Medplum
2. Create Bot resources via API
3. Upload compiled JS code
4. Create Subscriptions

### Other Pending
- AccessPolicy for roles
- Error handling standardization
- HIPAA docs

## Auth Info

Test user: admin@example.com / medplum_admin
API: http://localhost:8103
Web UI: http://localhost:3000

## For Next Claude Session

Tell it: "Read CURRENT_STATUS.md and deploy the bots to Medplum"