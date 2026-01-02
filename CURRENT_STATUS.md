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

### Deployed Bots (All 9 bots registered and running in Medplum)

| Bot | ID | Trigger |
|-----|-----|---------|
| Embedding Bot | d089f714-f746-4e97-a361-c5c1b376d13b | DiagnosticReport, DocumentReference, Observation, Condition, MedicationStatement |
| Semantic Search Bot | e8d04e1d-7309-463b-ba7b-86dda61e3bbe | API invoked |
| RAG Pipeline Bot | d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52 | API invoked |
| Command Processor Bot | 87780e52-abc5-4122-8225-07e74aaf18ca | API invoked |
| Approval Queue Bot | 3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01 | Task?code=ai-approval |
| Clinical Decision Support Bot | cee8c207-bd20-42c3-aaf4-0055c1f90853 | Encounter, MedicationRequest |
| Documentation Assistant Bot | b8b85bb2-e447-4556-a314-0da1ba06afe5 | API invoked |
| Billing Code Suggester Bot | 093a0c9d-44ea-4672-8208-d1d199962f33 | Encounter?status=finished |
| Audit Logging Bot | fce84f6d-02b2-42dc-8ae8-5dafdc84b882 | API invoked |

### Active Subscriptions (9 total)
- Embedding triggers for 5 clinical resource types
- CDS triggers for Encounter and MedicationRequest
- Billing trigger for finished Encounters
- Approval Queue trigger for ai-approval Tasks

### Config Files
- config/litellm-config.yaml (LLM routing)
- config/safety-filters.yaml (AI safety rules)
- config/postgres-init.sql (pgvector setup)

### Documentation
- README.md (project overview with bot IDs)
- ARCHITECTURE.md (system design, data flows, security)
- QUICKSTART.md (5-minute getting started guide)
- CURRENT_STATUS.md (this file)
- SCRIBE_INTEGRATION.md (AI scribe app docs)
- FLUTTER_FRONTEND_PROMPT.md (frontend planning)
- bots/README.md (bot documentation)
- bots/docs/DEPLOYMENT.md (deployment guide)
- bots/docs/API.md (API reference)

### Deployment Scripts
- deploy-bots.js (Node.js script to deploy bot code)
- create-subscriptions.js (Node.js script to create subscriptions)
- verify-deployment.js (Node.js script to verify deployment)

## Still Pending

- AccessPolicy for roles
- Error handling standardization
- HIPAA docs
- Integration testing with Ollama/LiteLLM

## Auth Info

Test user: admin@example.com / medplum
API: http://localhost:8103
Web UI: http://localhost:3000

## Invoking API Bots

For bots without subscriptions (Semantic Search, RAG Pipeline, Command Processor, Documentation Assistant, Audit Logging), invoke via:

```bash
curl -X POST "http://localhost:8103/fhir/R4/Bot/<BOT_ID>/$execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"input": {...}}'
```