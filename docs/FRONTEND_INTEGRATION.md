# FabricEMR Frontend Integration Guide

Complete reference for integrating a frontend application with the FabricEMR backend.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Server IP (LAN)** | `10.241.15.154` |
| **FHIR API** | `http://10.241.15.154:8103/fhir/R4` |
| **OAuth Authorize** | `http://10.241.15.154:8103/oauth2/authorize` |
| **OAuth Token** | `http://10.241.15.154:8103/oauth2/token` |
| **Web UI** | `http://10.241.15.154:3000` |
| **Your Client ID** | `c643cd48-e130-4b12-bc0d-80b0ac9f5dc4` |
| **Default Redirect URI** | `http://localhost:3001/oauth/callback` |

---

## 1. Network Configuration

### Server Addresses

The backend is accessible via multiple addresses depending on your network:

| Network | API URL | Web UI |
|---------|---------|--------|
| Tailscale/VPN | `http://10.241.15.154:8103` | `http://10.241.15.154:3000` |
| Local LAN | `http://172.16.100.45:8103` | `http://172.16.100.45:3000` |
| Same machine | `http://localhost:8103` | `http://localhost:3000` |

**Important:** The server is configured with `10.241.15.154` as the base URL. OAuth redirects will use this address. If your frontend is on a different network, contact the server admin to update the configuration.

### Ports

| Port | Service | Purpose |
|------|---------|---------|
| 8103 | Medplum Server | FHIR R4 API, OAuth, Bot execution |
| 3000 | Medplum App | Web UI (OAuth login screens) |
| 5432 | PostgreSQL | Database (internal) |
| 6379 | Redis | Cache (internal) |
| 8080 | LLM Router | AI model API (LiteLLM gateway) |

### Test Connectivity

```bash
# Test FHIR API
curl http://10.241.15.154:8103/healthcheck

# Expected response:
# {"ok":true,"version":"5.0.10","postgres":true,"redis":true}

# Test OpenID configuration
curl http://10.241.15.154:8103/.well-known/openid-configuration
```

---

## 2. Authentication (OAuth 2.0 + PKCE)

FabricEMR uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) for authentication. This is the recommended flow for mobile and single-page applications.

### Your OAuth Client

| Property | Value |
|----------|-------|
| Client ID | `c643cd48-e130-4b12-bc0d-80b0ac9f5dc4` |
| Client Name | FabricEMR Frontend |
| Redirect URI | `http://localhost:3001/oauth/callback` |
| Grant Types | `authorization_code`, `refresh_token` |
| PKCE Required | Yes (S256 recommended) |

### OAuth Endpoints

| Endpoint | URL |
|----------|-----|
| Authorization | `http://10.241.15.154:8103/oauth2/authorize` |
| Token | `http://10.241.15.154:8103/oauth2/token` |
| UserInfo | `http://10.241.15.154:8103/oauth2/userinfo` |
| Introspection | `http://10.241.15.154:8103/oauth2/introspect` |
| JWKS | `http://10.241.15.154:8103/.well-known/jwks.json` |

### Supported Scopes

- `openid` - Required for OpenID Connect
- `profile` - User profile information
- `email` - Email address
- `phone` - Phone number
- `address` - Address information

### Authentication Flow

#### Step 1: Generate PKCE Parameters

```javascript
// Generate code verifier (43-128 characters)
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

// Generate code challenge from verifier
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(hash));
}

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

#### Step 2: Redirect to Authorization

```javascript
const CLIENT_ID = 'c643cd48-e130-4b12-bc0d-80b0ac9f5dc4';
const REDIRECT_URI = 'http://localhost:3001/oauth/callback';
const AUTH_URL = 'http://10.241.15.154:8103/oauth2/authorize';

const codeVerifier = generateCodeVerifier();
const codeChallenge = await generateCodeChallenge(codeVerifier);
const state = generateRandomString(16); // For CSRF protection

// Store for later use
sessionStorage.setItem('code_verifier', codeVerifier);
sessionStorage.setItem('oauth_state', state);

const authUrl = new URL(AUTH_URL);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('scope', 'openid profile');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

window.location.href = authUrl.toString();
```

#### Step 3: Handle Callback

```javascript
// On callback page (e.g., /oauth/callback)
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
const returnedState = urlParams.get('state');

// Verify state matches
const savedState = sessionStorage.getItem('oauth_state');
if (returnedState !== savedState) {
  throw new Error('State mismatch - possible CSRF attack');
}

const codeVerifier = sessionStorage.getItem('code_verifier');
```

#### Step 4: Exchange Code for Token

```javascript
const TOKEN_URL = 'http://10.241.15.154:8103/oauth2/token';

const response = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  }),
});

const tokens = await response.json();
// {
//   access_token: "eyJhbGciOiJFUzI1NiIs...",
//   refresh_token: "...",
//   token_type: "Bearer",
//   expires_in: 3600,
//   id_token: "..."
// }
```

#### Step 5: Refresh Token

```javascript
const response = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CLIENT_ID,
  }),
});
```

### Test Credentials

For development/testing:

| Field | Value |
|-------|-------|
| Email | `admin@example.com` |
| Password | `medplum` |

---

## 3. FHIR R4 API

### Base URL

```
http://10.241.15.154:8103/fhir/R4
```

### Authentication Header

All FHIR API requests require authentication:

```
Authorization: Bearer <access_token>
```

### Common Operations

#### Search Patients

```bash
GET /fhir/R4/Patient?name=john&_count=10
Authorization: Bearer <token>
```

#### Get Patient by ID

```bash
GET /fhir/R4/Patient/{id}
Authorization: Bearer <token>
```

#### Create Patient

```bash
POST /fhir/R4/Patient
Authorization: Bearer <token>
Content-Type: application/fhir+json

{
  "resourceType": "Patient",
  "name": [{
    "family": "Smith",
    "given": ["John"]
  }],
  "birthDate": "1980-01-15",
  "gender": "male"
}
```

#### Update Patient

```bash
PUT /fhir/R4/Patient/{id}
Authorization: Bearer <token>
Content-Type: application/fhir+json

{
  "resourceType": "Patient",
  "id": "{id}",
  ...
}
```

### Supported Resource Types

Core clinical resources available:

| Category | Resources |
|----------|-----------|
| **Patient** | Patient, RelatedPerson, Person |
| **Encounter** | Encounter, EpisodeOfCare |
| **Clinical** | Condition, Observation, DiagnosticReport, Procedure |
| **Medications** | Medication, MedicationRequest, MedicationStatement, MedicationAdministration |
| **Scheduling** | Appointment, Schedule, Slot |
| **Documents** | DocumentReference, Composition |
| **Care Planning** | CarePlan, Goal, CareTeam |
| **Billing** | Claim, Coverage, ExplanationOfBenefit |
| **Admin** | Practitioner, Organization, Location |

### Search Parameters

Common search parameters:

```bash
# Pagination
?_count=20&_offset=0

# Sorting
?_sort=-_lastUpdated

# Include related resources
?_include=Observation:patient

# Date ranges
?date=ge2024-01-01&date=le2024-12-31

# Text search
?_content=diabetes
```

### Example: Fetch Patient with Conditions

```javascript
const patientId = '61db3759-ed64-4978-8ee4-ce6462d42ab4';

// Get patient
const patient = await fetch(
  `http://10.241.15.154:8103/fhir/R4/Patient/${patientId}`,
  { headers: { Authorization: `Bearer ${token}` } }
).then(r => r.json());

// Get patient's conditions
const conditions = await fetch(
  `http://10.241.15.154:8103/fhir/R4/Condition?patient=${patientId}`,
  { headers: { Authorization: `Bearer ${token}` } }
).then(r => r.json());
```

---

## 4. AI Bots

FabricEMR includes 9 AI-powered bots for clinical decision support.

### Available Bots

| Bot | ID | Invocation | Purpose |
|-----|-----|------------|---------|
| Semantic Search | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | API | Vector similarity search |
| RAG Pipeline | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | API | Clinical Q&A with context |
| Documentation Assistant | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | API | Generate clinical notes |
| Command Processor | `87780e52-abc5-4122-8225-07e74aaf18ca` | API | Validate AI commands |
| Clinical Decision Support | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | Auto | Diagnosis, drug interactions |
| Billing Code Suggester | `093a0c9d-44ea-4672-8208-d1d199962f33` | Auto | CPT/ICD-10 suggestions |
| Embedding Bot | `d089f714-f746-4e97-a361-c5c1b376d13b` | Auto | Generate embeddings |
| Approval Queue | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Auto | Human approval workflow |
| Audit Logging | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | API | AI audit trail |

### Invoking API Bots

```bash
POST /fhir/R4/Bot/{bot_id}/$execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "search query or input",
  "patientId": "optional-patient-id",
  "limit": 10
}
```

### Example: Semantic Search

```javascript
const response = await fetch(
  'http://10.241.15.154:8103/fhir/R4/Bot/e8d04e1d-7309-463b-ba7b-86dda61e3bbe/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'patient with uncontrolled blood pressure',
      patientId: 'patient-123',
      limit: 10
    }),
  }
);
```

### Example: Documentation Assistant

```javascript
const response = await fetch(
  'http://10.241.15.154:8103/fhir/R4/Bot/b8b85bb2-e447-4556-a314-0da1ba06afe5/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      patientId: 'patient-123',
      encounterId: 'encounter-456',
      noteType: 'SOAP',
      chiefComplaint: 'chest pain'
    }),
  }
);
```

---

## 5. LLM Router (Direct AI Access)

For advanced use cases, you can call the LLM Router directly.

### Connection Details

| Property | Value |
|----------|-------|
| URL | `http://10.241.15.154:8080` |
| API Key | `fabric-emr-secret-key` |
| Client ID | `fabric-emr` |
| API Format | OpenAI-compatible |

### Required Headers

```
Authorization: Bearer fabric-emr-secret-key
X-Client-Id: fabric-emr
X-Clinic-Task: <task_name>
Content-Type: application/json
```

### Available Models

| Model Alias | Purpose |
|-------------|---------|
| `clinical-model` | Text generation (clinical reasoning) |
| `fast-model` | Quick responses |
| `embedding-model` | 768-dim text embeddings |
| `soap-model` | SOAP note generation |
| `ocr-model` | OCR tasks |

### Example: Chat Completion

```javascript
const response = await fetch('http://10.241.15.154:8080/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer fabric-emr-secret-key',
    'X-Client-Id': 'fabric-emr',
    'X-Clinic-Task': 'clinical_decision',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'clinical-model',
    messages: [
      { role: 'system', content: 'You are a clinical assistant.' },
      { role: 'user', content: 'What are common causes of chest pain?' }
    ],
    temperature: 0.7,
    max_tokens: 500
  }),
});
```

### Example: Generate Embeddings

```javascript
const response = await fetch('http://10.241.15.154:8080/v1/embeddings', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer fabric-emr-secret-key',
    'X-Client-Id': 'fabric-emr',
    'X-Clinic-Task': 'embedding',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'embedding-model',
    input: 'Patient presents with acute chest pain radiating to left arm'
  }),
});
// Returns 768-dimensional embedding vector
```

---

## 6. Updating Redirect URI

If your frontend uses a different callback URL, update the ClientApplication:

```bash
# Get auth token first
CODE=$(curl -s -X POST http://10.241.15.154:8103/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}' \
  | jq -r '.code')

TOKEN=$(curl -s -X POST http://10.241.15.154:8103/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=$CODE&code_verifier=test" \
  | jq -r '.access_token')

# Update the redirect URI
curl -X PATCH "http://10.241.15.154:8103/fhir/R4/ClientApplication/c643cd48-e130-4b12-bc0d-80b0ac9f5dc4" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"op": "replace", "path": "/redirectUri", "value": "myapp://oauth/callback"}
  ]'
```

Or contact the server admin to update it via the Medplum web UI at `http://10.241.15.154:3000`.

---

## 7. Sample Code

### React/TypeScript with @medplum/core

```typescript
import { MedplumClient } from '@medplum/core';

const medplum = new MedplumClient({
  baseUrl: 'http://10.241.15.154:8103/',
  clientId: 'c643cd48-e130-4b12-bc0d-80b0ac9f5dc4',
});

// Start OAuth flow
await medplum.startLogin({
  redirectUri: 'http://localhost:3001/oauth/callback',
  scope: 'openid profile',
});

// After callback, complete login
await medplum.processCode(code);

// Now you can make API calls
const patients = await medplum.searchResources('Patient', { name: 'john' });
```

### Flutter/Dart

```dart
import 'package:oauth2/oauth2.dart' as oauth2;

final authorizationEndpoint = Uri.parse('http://10.241.15.154:8103/oauth2/authorize');
final tokenEndpoint = Uri.parse('http://10.241.15.154:8103/oauth2/token');
final clientId = 'c643cd48-e130-4b12-bc0d-80b0ac9f5dc4';
final redirectUrl = Uri.parse('http://localhost:3001/oauth/callback');

var grant = oauth2.AuthorizationCodeGrant(
  clientId,
  authorizationEndpoint,
  tokenEndpoint,
);

// Get authorization URL
var authorizationUrl = grant.getAuthorizationUrl(redirectUrl, scopes: ['openid', 'profile']);

// After redirect, exchange code
var client = await grant.handleAuthorizationResponse(responseParams);

// Make API calls
var response = await client.get(Uri.parse('http://10.241.15.154:8103/fhir/R4/Patient'));
```

---

## 8. Error Handling

### Common HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Check request format |
| 401 | Unauthorized | Refresh token or re-authenticate |
| 403 | Forbidden | User lacks permission |
| 404 | Not Found | Resource doesn't exist |
| 422 | Unprocessable | Validation error (check OperationOutcome) |

### OperationOutcome Errors

FHIR errors return OperationOutcome resources:

```json
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "invalid",
    "details": {
      "text": "Description of the error"
    }
  }]
}
```

---

## 9. Security Considerations

### PHI Protection

- All PHI stays on-premises - no data sent to external cloud LLMs
- Local LLM Router handles all AI processing
- Audit logs track all data access

### Token Security

- Access tokens expire in 1 hour
- Store tokens securely (not in localStorage for web apps)
- Use refresh tokens to maintain sessions
- Clear tokens on logout

### CORS

The server allows CORS from any origin (`*`). For production, this should be restricted.

---

## 10. Support & Resources

### Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [CURRENT_STATUS.md](./CURRENT_STATUS.md) - Deployment status, bot IDs
- [bots/docs/API.md](../bots/docs/API.md) - Bot API reference

### Test Data

The system has 46 test patients and 1 practitioner (Medplum Admin) available for development.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Check server is running: `curl http://10.241.15.154:8103/healthcheck` |
| OAuth redirect fails | Ensure redirect URI matches exactly what's registered |
| Token expired | Use refresh token or re-authenticate |
| CORS errors | Verify Origin header is being sent |
| Bot execution fails | Bots may need redeployment - contact server admin |

---

## Appendix: OAuth Client Details

```json
{
  "resourceType": "ClientApplication",
  "id": "c643cd48-e130-4b12-bc0d-80b0ac9f5dc4",
  "name": "FabricEMR Frontend",
  "description": "Web/Mobile frontend application for FabricEMR",
  "redirectUri": "http://localhost:3001/oauth/callback",
  "launchUri": "http://localhost:3001"
}
```

To view or modify via Medplum Admin UI:
1. Go to `http://10.241.15.154:3000`
2. Login with `admin@example.com` / `medplum`
3. Navigate to Admin → Project -> Client Applications
