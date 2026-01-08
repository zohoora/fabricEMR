# FabricEMR Backend Access

Instructions for frontend/AI applications to connect to the FabricEMR backend.

## Server Hostname

```
Arashs-MacBook-Pro.local
```

> Uses mDNS/Bonjour. If hostname doesn't resolve on your network, get the IP with:
> ```bash
> ping Arashs-MacBook-Pro.local
> ```

## Endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| **Medplum API** | `http://Arashs-MacBook-Pro.local:8103` | FHIR R4 API, Bot execution, OAuth |
| **Medplum App** | `http://Arashs-MacBook-Pro.local:3000` | Web UI, OAuth login screen |
| **LLM Gateway** | `http://Arashs-MacBook-Pro.local:8080` | LiteLLM proxy for AI models |
| **Ollama** | `http://Arashs-MacBook-Pro.local:11434` | Direct Ollama access |

## OAuth 2.0 + PKCE Authentication

### Registered Client

| Field | Value |
|-------|-------|
| **Client ID** | `af1464aa-e00c-4940-a32e-18d878b7911c` |
| **Redirect URI** | `fabricscribe://oauth/callback` |
| **PKCE** | Required (S256) |

### OAuth Endpoints

| Endpoint | URL |
|----------|-----|
| **Authorization** | `http://Arashs-MacBook-Pro.local:8103/oauth2/authorize` |
| **Token** | `http://Arashs-MacBook-Pro.local:8103/oauth2/token` |
| **UserInfo** | `http://Arashs-MacBook-Pro.local:8103/oauth2/userinfo` |

### Authorization URL Format

```
http://Arashs-MacBook-Pro.local:8103/oauth2/authorize?
  response_type=code&
  client_id=af1464aa-e00c-4940-a32e-18d878b7911c&
  redirect_uri=fabricscribe://oauth/callback&
  scope=openid+profile&
  code_challenge=<BASE64_URL_ENCODED_SHA256>&
  code_challenge_method=S256&
  state=<RANDOM_STATE>
```

### Token Exchange

```bash
curl -X POST http://Arashs-MacBook-Pro.local:8103/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'code=<AUTH_CODE>' \
  -d 'code_verifier=<ORIGINAL_VERIFIER>' \
  -d 'client_id=af1464aa-e00c-4940-a32e-18d878b7911c' \
  -d 'redirect_uri=fabricscribe://oauth/callback'
```

### Test Credentials (for manual login)

```
Email:    admin@example.com
Password: medplum123
```

## FHIR R4 API

Base URL: `http://Arashs-MacBook-Pro.local:8103/fhir/R4`

### Example Requests

```bash
# Get current user
curl -H "Authorization: Bearer $TOKEN" \
  http://Arashs-MacBook-Pro.local:8103/fhir/R4/Practitioner/$me

# List patients
curl -H "Authorization: Bearer $TOKEN" \
  http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient

# Search encounters
curl -H "Authorization: Bearer $TOKEN" \
  "http://Arashs-MacBook-Pro.local:8103/fhir/R4/Encounter?status=in-progress"

# Create a resource
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{"resourceType":"Patient","name":[{"given":["Test"],"family":"Patient"}]}' \
  http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient
```

## AI Bots

### Execute a Bot

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": "your input here"}' \
  http://Arashs-MacBook-Pro.local:8103/fhir/R4/Bot/<BOT_ID>/$execute
```

### Available Bots

| Bot | ID | Purpose |
|-----|-----|---------|
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` | Generate embeddings for clinical resources |
| Semantic Search Bot | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | Search clinical data by meaning |
| RAG Pipeline Bot | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | Retrieval-augmented generation |
| Command Processor Bot | `87780e52-abc5-4122-8225-07e74aaf18ca` | Process natural language commands |
| Approval Queue Bot | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Human-in-the-loop approval workflow |
| Clinical Decision Support Bot | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | CDS alerts and recommendations |
| Documentation Assistant Bot | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | Help with clinical documentation |
| Billing Code Suggester Bot | `093a0c9d-44ea-4672-8208-d1d199962f33` | Suggest ICD-10/CPT codes |
| Audit Logging Bot | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | Audit trail for AI actions |

## LLM Gateway (LiteLLM)

```
Base URL: http://Arashs-MacBook-Pro.local:8080
API Key:  sk-medplum-ai
```

### Available Models

| Model | Purpose |
|-------|---------|
| `ollama/nomic-embed-text` | Text embeddings (768 dimensions) |
| `ollama/qwen3:4b` | General chat/completion |

### Example Request

```bash
curl -X POST http://Arashs-MacBook-Pro.local:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-medplum-ai' \
  -d '{
    "model": "ollama/qwen3:4b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Embeddings

```bash
curl -X POST http://Arashs-MacBook-Pro.local:8080/v1/embeddings \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-medplum-ai' \
  -d '{
    "model": "ollama/nomic-embed-text",
    "input": "Patient presenting with chest pain"
  }'
```

## Registering a New OAuth Client

If you need a different redirect URI for your app:

```bash
# Get token first
TOKEN=$(curl -s -X POST http://Arashs-MacBook-Pro.local:8103/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"medplum123","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}' \
  | jq -r '.code' | xargs -I {} curl -s -X POST http://Arashs-MacBook-Pro.local:8103/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code={}&code_verifier=test" | jq -r '.access_token')

# Create new client
curl -X POST http://Arashs-MacBook-Pro.local:8103/fhir/R4/ClientApplication \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/fhir+json' \
  -d '{
    "resourceType": "ClientApplication",
    "name": "My App",
    "description": "My frontend application",
    "redirectUri": "myapp://oauth/callback"
  }'
```

## Troubleshooting

### Hostname doesn't resolve
Use IP address instead. Run on the server machine:
```bash
./update-network-config.sh ip
docker compose restart medplum-server
```

### CORS errors
The server allows all origins (`allowedOrigins: "*"`). If you still get CORS errors, ensure you're using the correct protocol (http, not https).

### Token expired
Tokens expire after ~1 hour. Request a new one using the OAuth flow.

### OAuth redirects to wrong URL
The server must be configured with the correct `appBaseUrl`. Currently set to:
```
http://Arashs-MacBook-Pro.local:3000/
```
