# FabricEMR Frontend Integration Guide

Complete documentation for integrating an EMR frontend with the FabricEMR backend services.

## Server Information

**Hostname:** `Arashs-MacBook-Pro.local` (works across networks via mDNS/Bonjour)

> If hostname doesn't resolve, get the current IP:
> ```bash
> ping Arashs-MacBook-Pro.local
> # or on the server machine:
> ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1
> ```

---

## Services Overview

| Service | URL | Purpose |
|---------|-----|---------|
| **Medplum API** | `http://Arashs-MacBook-Pro.local:8103` | FHIR R4 API, OAuth, Bot execution |
| **Medplum App** | `http://Arashs-MacBook-Pro.local:3000` | OAuth login UI |
| **LLM Gateway** | `http://Arashs-MacBook-Pro.local:8080` | AI model proxy (LiteLLM) |
| **Ollama** | `http://Arashs-MacBook-Pro.local:11434` | Direct LLM access |
| **Whisper** | `http://Arashs-MacBook-Pro.local:8000` | Speech-to-text (if running) |

---

## 1. Authentication (OAuth 2.0 + PKCE)

The backend uses OAuth 2.0 with PKCE for secure authentication.

### Registered OAuth Client

| Field | Value |
|-------|-------|
| Client ID | `af1464aa-e00c-4940-a32e-18d878b7911c` |
| Redirect URI | `fabricscribe://oauth/callback` |
| PKCE | Required (S256) |

### OAuth Endpoints

| Endpoint | URL |
|----------|-----|
| Authorization | `http://Arashs-MacBook-Pro.local:8103/oauth2/authorize` |
| Token | `http://Arashs-MacBook-Pro.local:8103/oauth2/token` |
| UserInfo | `http://Arashs-MacBook-Pro.local:8103/oauth2/userinfo` |

### Authentication Flow

#### Step 1: Generate PKCE Values

```javascript
// Generate code verifier (43-128 characters)
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

// Generate code challenge (SHA-256 hash of verifier)
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

#### Step 2: Authorization Request

Redirect user to:

```
http://Arashs-MacBook-Pro.local:8103/oauth2/authorize?
  response_type=code&
  client_id=af1464aa-e00c-4940-a32e-18d878b7911c&
  redirect_uri=fabricscribe://oauth/callback&
  scope=openid profile&
  code_challenge=<CODE_CHALLENGE>&
  code_challenge_method=S256&
  state=<RANDOM_STATE>
```

User will see the Medplum login screen at port 3000, then be redirected back with an authorization code.

#### Step 3: Token Exchange

```javascript
const response = await fetch('http://Arashs-MacBook-Pro.local:8103/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: '<AUTH_CODE_FROM_REDIRECT>',
    code_verifier: '<ORIGINAL_CODE_VERIFIER>',
    client_id: 'af1464aa-e00c-4940-a32e-18d878b7911c',
    redirect_uri: 'fabricscribe://oauth/callback',
  }),
});

const { access_token, refresh_token, expires_in } = await response.json();
```

#### Step 4: Use Access Token

Include in all API requests:

```javascript
headers: {
  'Authorization': `Bearer ${access_token}`
}
```

### Test Credentials (Development Only)

```
Email:    admin@example.com
Password: medplum123
```

### Registering a New OAuth Client

If your app needs a different redirect URI:

```javascript
// First get an admin token, then:
const response = await fetch('http://Arashs-MacBook-Pro.local:8103/fhir/R4/ClientApplication', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/fhir+json',
  },
  body: JSON.stringify({
    resourceType: 'ClientApplication',
    name: 'My EMR Frontend',
    description: 'EMR frontend application',
    redirectUri: 'myapp://oauth/callback',
    pkceOptional: false
  }),
});

const client = await response.json();
// Use client.id as your new client_id
```

---

## 2. FHIR R4 API

Base URL: `http://Arashs-MacBook-Pro.local:8103/fhir/R4`

### Common Operations

#### Get Current User (Practitioner)

```javascript
const response = await fetch('http://Arashs-MacBook-Pro.local:8103/fhir/R4/Practitioner/$me', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const practitioner = await response.json();
```

#### List Resources

```javascript
// List all patients
const patients = await fetch('http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// List encounters with filters
const encounters = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Encounter?status=in-progress&_sort=-date',
  { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());
```

#### Get Single Resource

```javascript
const patient = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient/patient-id-here',
  { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());
```

#### Create Resource

```javascript
const newPatient = await fetch('http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/fhir+json',
  },
  body: JSON.stringify({
    resourceType: 'Patient',
    name: [{ given: ['John'], family: 'Doe' }],
    birthDate: '1990-01-15',
    gender: 'male',
  }),
}).then(r => r.json());
```

#### Update Resource

```javascript
const updated = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient/patient-id-here',
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify({
      resourceType: 'Patient',
      id: 'patient-id-here',
      name: [{ given: ['John', 'Michael'], family: 'Doe' }],
      // ... other fields
    }),
  }
).then(r => r.json());
```

#### Search with Parameters

```javascript
// Search patients by name
const results = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Patient?name=John&_count=20',
  { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());

// Search observations for a patient
const observations = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Observation?patient=Patient/patient-id&_sort=-date',
  { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());
```

### Common FHIR Resources

| Resource | Description |
|----------|-------------|
| `Patient` | Patient demographics |
| `Practitioner` | Healthcare providers |
| `Encounter` | Patient visits/appointments |
| `Observation` | Clinical observations, vitals, lab results |
| `Condition` | Diagnoses, problems |
| `MedicationRequest` | Prescriptions |
| `MedicationStatement` | Medication history |
| `DiagnosticReport` | Lab reports, imaging reports |
| `DocumentReference` | Clinical documents |
| `Task` | Workflow tasks, AI command approvals |

---

## 3. AI Bots

Execute AI-powered bots for clinical assistance.

### Execute a Bot

```javascript
const result = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Bot/<BOT_ID>/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Input varies by bot - see individual bot documentation
      input: 'your input here',
    }),
  }
).then(r => r.json());
```

### Available Bots

| Bot | ID | Input | Purpose |
|-----|-----|-------|---------|
| **Semantic Search** | `e8d04e1d-7309-463b-ba7b-86dda61e3bbe` | `{ query: string, patientId?: string }` | Search clinical data by meaning |
| **RAG Pipeline** | `d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52` | `{ question: string, patientId: string }` | Answer questions using patient context |
| **Command Processor** | `87780e52-abc5-4122-8225-07e74aaf18ca` | `{ command: string, patientId: string }` | Process natural language commands |
| **Documentation Assistant** | `b8b85bb2-e447-4556-a314-0da1ba06afe5` | `{ encounterNote: string }` | Help with clinical documentation |
| **Billing Code Suggester** | `093a0c9d-44ea-4672-8208-d1d199962f33` | `{ encounterId: string }` | Suggest ICD-10/CPT codes |
| **Clinical Decision Support** | `cee8c207-bd20-42c3-aaf4-0055c1f90853` | `{ encounterId: string }` | CDS alerts and recommendations |
| **Embedding Bot** | `d089f714-f746-4e97-a361-c5c1b376d13b` | FHIR resource | Generate embeddings (auto-triggered) |
| **Approval Queue** | `3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01` | Task resource | Human-in-the-loop approvals |
| **Audit Logging** | `fce84f6d-02b2-42dc-8ae8-5dafdc84b882` | Audit event | Log AI actions |

### Example: Semantic Search

```javascript
const searchResults = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Bot/e8d04e1d-7309-463b-ba7b-86dda61e3bbe/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'patient history of diabetes',
      patientId: 'patient-123',
    }),
  }
).then(r => r.json());
```

### Example: RAG Pipeline (Question Answering)

```javascript
const answer = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Bot/d7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question: 'What medications is this patient currently taking?',
      patientId: 'patient-123',
    }),
  }
).then(r => r.json());
```

### Example: Command Processor

```javascript
const commandResult = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Bot/87780e52-abc5-4122-8225-07e74aaf18ca/$execute',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      command: 'Order a CBC and BMP for this patient',
      patientId: 'patient-123',
      encounterId: 'encounter-456',
    }),
  }
).then(r => r.json());
// Returns a Task resource requiring approval
```

---

## 4. LLM Gateway (LiteLLM)

Direct access to AI models for custom integrations.

**Base URL:** `http://Arashs-MacBook-Pro.local:8080`
**API Key:** `sk-medplum-ai`

### Available Models

| Model | Purpose |
|-------|---------|
| `ollama/nomic-embed-text` | Text embeddings (768 dimensions) |
| `ollama/qwen3:4b` | Chat/completion |

### Chat Completions

```javascript
const response = await fetch('http://Arashs-MacBook-Pro.local:8080/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-medplum-ai',
  },
  body: JSON.stringify({
    model: 'ollama/qwen3:4b',
    messages: [
      { role: 'system', content: 'You are a helpful medical assistant.' },
      { role: 'user', content: 'Summarize this patient note: ...' },
    ],
    temperature: 0.7,
    max_tokens: 500,
  }),
});

const { choices } = await response.json();
const assistantMessage = choices[0].message.content;
```

### Streaming Chat

```javascript
const response = await fetch('http://Arashs-MacBook-Pro.local:8080/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-medplum-ai',
  },
  body: JSON.stringify({
    model: 'ollama/qwen3:4b',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

  for (const line of lines) {
    const data = line.slice(6);
    if (data === '[DONE]') continue;

    const parsed = JSON.parse(data);
    const content = parsed.choices[0]?.delta?.content;
    if (content) {
      process.stdout.write(content); // or update UI
    }
  }
}
```

### Text Embeddings

```javascript
const response = await fetch('http://Arashs-MacBook-Pro.local:8080/v1/embeddings', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-medplum-ai',
  },
  body: JSON.stringify({
    model: 'ollama/nomic-embed-text',
    input: 'Patient presenting with chest pain and shortness of breath',
  }),
});

const { data } = await response.json();
const embedding = data[0].embedding; // 768-dimensional vector
```

---

## 5. Speech-to-Text (Whisper)

> **Note:** The Whisper server may need to be started manually.

**URL:** `http://Arashs-MacBook-Pro.local:8000`

### Start Whisper Server (if not running)

On the server machine:
```bash
docker run -d --name whisper-server \
  -p 8000:8000 \
  --restart unless-stopped \
  ghcr.io/speaches-ai/speaches:latest-cpu
```

### Transcribe Audio

```javascript
const formData = new FormData();
formData.append('file', audioBlob, 'recording.wav');
formData.append('model', 'base'); // or 'small', 'medium', 'large'

const response = await fetch('http://Arashs-MacBook-Pro.local:8000/v1/audio/transcriptions', {
  method: 'POST',
  body: formData,
});

const { text } = await response.json();
console.log('Transcription:', text);
```

### Transcribe with Timestamps

```javascript
const formData = new FormData();
formData.append('file', audioBlob, 'recording.wav');
formData.append('model', 'base');
formData.append('response_format', 'verbose_json');
formData.append('timestamp_granularities[]', 'word');

const response = await fetch('http://Arashs-MacBook-Pro.local:8000/v1/audio/transcriptions', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
// result.words contains word-level timestamps
```

---

## 6. Real-time Subscriptions

FHIR Subscriptions automatically trigger bots when resources change.

### Active Subscriptions

| Trigger | Bot |
|---------|-----|
| DiagnosticReport created/updated | Embedding Bot |
| DocumentReference created/updated | Embedding Bot |
| Observation created/updated | Embedding Bot |
| Condition created/updated | Embedding Bot |
| MedicationStatement created/updated | Embedding Bot |
| Encounter created/updated | Clinical Decision Support |
| MedicationRequest created/updated | Clinical Decision Support |
| Encounter status=finished | Billing Code Suggester |
| Task with ai-command code | Approval Queue |

### Creating Custom Subscriptions

```javascript
const subscription = await fetch('http://Arashs-MacBook-Pro.local:8103/fhir/R4/Subscription', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/fhir+json',
  },
  body: JSON.stringify({
    resourceType: 'Subscription',
    status: 'active',
    reason: 'Custom notification',
    criteria: 'Patient?_lastUpdated=gt2024-01-01',
    channel: {
      type: 'rest-hook',
      endpoint: 'https://your-webhook-url.com/notify',
      payload: 'application/fhir+json',
    },
  }),
}).then(r => r.json());
```

---

## 7. Human-in-the-Loop Approvals

AI commands that modify data go through an approval workflow.

### Check Pending Approvals

```javascript
const pendingTasks = await fetch(
  'http://Arashs-MacBook-Pro.local:8103/fhir/R4/Task?status=requested&code=http://medplum.com/fhir/CodeSystem/ai-command|',
  { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());
```

### Approve a Task

```javascript
const approvedTask = await fetch(
  `http://Arashs-MacBook-Pro.local:8103/fhir/R4/Task/${taskId}`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify({
      ...existingTask,
      status: 'accepted',
    }),
  }
).then(r => r.json());
```

### Reject a Task

```javascript
const rejectedTask = await fetch(
  `http://Arashs-MacBook-Pro.local:8103/fhir/R4/Task/${taskId}`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify({
      ...existingTask,
      status: 'rejected',
      statusReason: { text: 'Reason for rejection' },
    }),
  }
).then(r => r.json());
```

---

## 8. Error Handling

### Common HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Check request body/parameters |
| 401 | Unauthorized | Token expired, re-authenticate |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 422 | Unprocessable | Validation error, check OperationOutcome |

### Error Response Format

```json
{
  "resourceType": "OperationOutcome",
  "issue": [
    {
      "severity": "error",
      "code": "invalid",
      "details": {
        "text": "Description of what went wrong"
      }
    }
  ]
}
```

### Token Refresh

Tokens expire after ~1 hour. Implement token refresh:

```javascript
async function fetchWithAuth(url, options = {}) {
  let response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    // Re-authenticate
    await refreshToken(); // or redirect to OAuth flow
    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    });
  }

  return response;
}
```

---

## 9. Troubleshooting

### Hostname doesn't resolve

```bash
# On the server, switch to IP mode:
cd /Users/arash/FabricEMR/fabricEMR
./update-network-config.sh ip
docker compose restart medplum-server
```

### CORS errors

The server allows all origins. Ensure you're using `http://` not `https://`.

### Connection refused

Check if services are running:
```bash
# On the server:
docker ps
curl http://localhost:8103/healthcheck
```

### OAuth redirects to wrong URL

The server's `appBaseUrl` must match. Currently:
```
http://Arashs-MacBook-Pro.local:3000/
```

### Whisper not responding

Start the Whisper server:
```bash
docker start whisper-server
# or if it doesn't exist:
docker run -d --name whisper-server -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
```

---

## Quick Reference

```javascript
// Configuration object
const config = {
  medplumApi: 'http://Arashs-MacBook-Pro.local:8103',
  medplumApp: 'http://Arashs-MacBook-Pro.local:3000',
  llmGateway: 'http://Arashs-MacBook-Pro.local:8080',
  whisper: 'http://Arashs-MacBook-Pro.local:8000',
  ollama: 'http://Arashs-MacBook-Pro.local:11434',

  oauth: {
    clientId: 'af1464aa-e00c-4940-a32e-18d878b7911c',
    redirectUri: 'fabricscribe://oauth/callback',
    authorizeUrl: 'http://Arashs-MacBook-Pro.local:8103/oauth2/authorize',
    tokenUrl: 'http://Arashs-MacBook-Pro.local:8103/oauth2/token',
  },

  llmApiKey: 'sk-medplum-ai',

  bots: {
    semanticSearch: 'e8d04e1d-7309-463b-ba7b-86dda61e3bbe',
    ragPipeline: 'd7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52',
    commandProcessor: '87780e52-abc5-4122-8225-07e74aaf18ca',
    documentationAssistant: 'b8b85bb2-e447-4556-a314-0da1ba06afe5',
    billingCodeSuggester: '093a0c9d-44ea-4672-8208-d1d199962f33',
    clinicalDecisionSupport: 'cee8c207-bd20-42c3-aaf4-0055c1f90853',
  },
};
```
