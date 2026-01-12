# Flutter EMR Frontend Development Prompt

> This prompt is designed for an AI agent to plan and develop a Flutter-based EMR frontend for FabricEMR.

---

## Project Overview

You are tasked with planning and developing a **Flutter-based EMR (Electronic Medical Record) frontend** for FabricEMR, an AI-native healthcare platform. This will be a fully-fledged EMR application, not just a viewer.

---

## Backend Architecture

### Core Services

| Service | Port | Purpose |
|---------|------|---------|
| **Medplum Server** | `localhost:8103` | FHIR R4 API server (main backend) |
| **PostgreSQL + pgvector** | `localhost:5432` | Database with vector embeddings (768-dim) |
| **Redis** | `localhost:6379` | Caching and session management |
| **LLM Router** | `localhost:4000` | OpenAI-compatible LLM routing |
| **LLM Gateway (legacy)** | `localhost:8080` | Legacy LiteLLM proxy (optional) |

### Technology Stack

- **FHIR R4**: Healthcare data standard
- **Medplum**: Open-source healthcare platform
- **LLM Router**: OpenAI-compatible API gateway (routes to Ollama/cloud LLMs)
- **Ollama**: Local LLM inference backend (qwen3:4b, nomic-embed-text)
- **pgvector**: PostgreSQL extension for vector similarity search (768-dim)

---

## Authentication

### OAuth 2.0 with PKCE Flow

The Flutter app must implement OAuth 2.0 with PKCE (Proof Key for Code Exchange):

```
1. Generate code_verifier (random string)
2. Generate code_challenge = base64url(sha256(code_verifier))
3. Redirect to: {base_url}/oauth2/authorize?
     response_type=code&
     client_id={client_id}&
     redirect_uri={redirect_uri}&
     scope=openid&
     code_challenge={code_challenge}&
     code_challenge_method=S256
4. User logs in, receives authorization code
5. Exchange code for tokens:
   POST {base_url}/oauth2/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&
   code={auth_code}&
   redirect_uri={redirect_uri}&
   code_verifier={code_verifier}&
   client_id={client_id}
```

### Base URL
- **API Base**: `http://localhost:8103`
- **FHIR Endpoint**: `http://localhost:8103/fhir/R4`

---

## FHIR Resources

The EMR uses standard FHIR R4 resources:

| Resource | Purpose |
|----------|---------|
| **Patient** | Patient demographics |
| **Practitioner** | Healthcare providers |
| **Encounter** | Patient visits/sessions |
| **DocumentReference** | Clinical documents (SOAP notes, transcripts) |
| **Media** | Audio/video files |
| **Binary** | Raw file content |
| **Observation** | Clinical observations |
| **Condition** | Diagnoses |
| **MedicationRequest** | Prescriptions |
| **AllergyIntolerance** | Allergies |
| **Procedure** | Medical procedures |
| **DiagnosticReport** | Lab results |
| **ServiceRequest** | Orders |
| **Task** | Workflow tasks |
| **Communication** | Messages |

---

## AI Bots - Complete API Reference

### 1. Embedding Bot

**Purpose**: Generates vector embeddings for semantic search

**Input (Bot Input)**:
```json
{
  "text": "string - text to embed",
  "resourceType": "string - optional FHIR resource type",
  "resourceId": "string - optional resource ID"
}
```

**Output**: Stores embedding in pgvector, returns success status

---

### 2. Semantic Search Bot

**Purpose**: Find similar clinical content using vector similarity

**Input**:
```json
{
  "query": "string - natural language search query",
  "resourceTypes": ["array of FHIR resource types to search"],
  "limit": "number - max results (default 10)",
  "threshold": "number - similarity threshold 0-1"
}
```

**Output**:
```json
{
  "results": [
    {
      "resourceType": "string",
      "resourceId": "string",
      "score": "number - similarity score",
      "snippet": "string - relevant text excerpt"
    }
  ]
}
```

---

### 3. RAG Pipeline Bot

**Purpose**: Retrieval-Augmented Generation for clinical queries

**Input**:
```json
{
  "query": "string - clinical question",
  "patientId": "string - optional patient context",
  "includeHistory": "boolean - include patient history"
}
```

**Output**:
```json
{
  "answer": "string - AI-generated response",
  "sources": [
    {
      "resourceType": "string",
      "resourceId": "string",
      "relevance": "number"
    }
  ],
  "confidence": "number - 0-1"
}
```

---

### 4. Command Processor Bot

**Purpose**: Process natural language clinical commands

**Input**:
```json
{
  "command": "string - natural language command",
  "context": {
    "patientId": "string",
    "encounterId": "string",
    "practitionerId": "string"
  }
}
```

**Output**:
```json
{
  "action": "string - identified action type",
  "parameters": {},
  "requiresApproval": "boolean",
  "blocked": "boolean",
  "blockReason": "string - if blocked"
}
```

**Action Types**: `create_order`, `update_medication`, `schedule_followup`, `add_diagnosis`, etc.

---

### 5. Approval Queue Bot

**Purpose**: Manage actions requiring human approval

**Input (Create)**:
```json
{
  "action": "create",
  "task": {
    "type": "string - action type",
    "patientId": "string",
    "details": {},
    "requestedBy": "string - practitioner ID"
  }
}
```

**Input (Process)**:
```json
{
  "action": "approve" | "reject",
  "taskId": "string",
  "reviewerId": "string",
  "notes": "string - optional"
}
```

**Output**: Task resource with status

---

### 6. Clinical Decision Support Bot

**Purpose**: AI-powered clinical recommendations

**Input**:
```json
{
  "patientId": "string",
  "context": "string - clinical scenario",
  "requestType": "diagnosis" | "treatment" | "drug_interaction" | "general"
}
```

**Output**:
```json
{
  "recommendations": [
    {
      "type": "string",
      "description": "string",
      "confidence": "number",
      "evidence": ["array of sources"],
      "urgency": "routine" | "urgent" | "emergent"
    }
  ],
  "warnings": ["array of safety warnings"],
  "interactions": ["drug interactions if applicable"]
}
```

---

### 7. Documentation Assistant Bot

**Purpose**: Generate and improve clinical documentation

**Input**:
```json
{
  "action": "generate" | "improve" | "summarize",
  "content": "string - existing content or transcript",
  "documentType": "soap" | "progress_note" | "discharge_summary" | "referral",
  "patientId": "string"
}
```

**Output**:
```json
{
  "document": "string - generated/improved document",
  "sections": {
    "subjective": "string",
    "objective": "string",
    "assessment": "string",
    "plan": "string"
  },
  "suggestions": ["improvement suggestions"]
}
```

---

### 8. Billing Code Suggester Bot

**Purpose**: Suggest appropriate billing codes

**Input**:
```json
{
  "encounterId": "string",
  "diagnoses": ["array of diagnosis descriptions"],
  "procedures": ["array of procedure descriptions"],
  "visitType": "string"
}
```

**Output**:
```json
{
  "icd10Codes": [
    {
      "code": "string",
      "description": "string",
      "confidence": "number"
    }
  ],
  "cptCodes": [
    {
      "code": "string",
      "description": "string",
      "confidence": "number"
    }
  ],
  "modifiers": ["applicable modifiers"],
  "warnings": ["coding warnings"]
}
```

---

### 9. Audit Logging Bot

**Purpose**: Comprehensive audit trail for compliance

**Input**:
```json
{
  "action": "log" | "query",
  "event": {
    "type": "string - event type",
    "userId": "string",
    "patientId": "string",
    "resourceType": "string",
    "resourceId": "string",
    "details": {}
  }
}
```

**Event Types**: `access`, `create`, `update`, `delete`, `export`, `print`, `ai_query`

---

## Safety Filters Configuration

The AI system has safety controls that the frontend must respect:

### Blocked Actions (Always Denied)
```yaml
blocked_actions:
  - pattern: "prescribe controlled"
    reason: "Controlled substances require in-person evaluation"
  - pattern: "delete patient"
    reason: "Patient records cannot be deleted"
  - pattern: "modify allergy.*severe"
    reason: "Severe allergy modifications require pharmacist review"
```

### Approval Required Actions
```yaml
approval_required:
  - pattern: "medication.*change"
    approvers: ["physician", "pharmacist"]
  - pattern: "discharge"
    approvers: ["attending_physician"]
  - pattern: "order.*imaging"
    approvers: ["ordering_physician"]
```

### Confidence Thresholds
```yaml
confidence_thresholds:
  diagnosis_suggestion: 0.85
  medication_recommendation: 0.90
  billing_code: 0.80
```

### Quiet Hours
```yaml
quiet_hours:
  enabled: true
  start: "22:00"
  end: "06:00"
  timezone: "America/Los_Angeles"
  blocked_during_quiet:
    - "non_urgent_notifications"
    - "batch_processing"
```

---

## EMR Features to Implement

### Core Clinical Features
1. **Patient Management**
   - Patient search and registration
   - Demographics editing
   - Patient timeline/history view
   - Family history

2. **Encounter Management**
   - Create new encounters
   - Encounter templates
   - Visit documentation
   - Encounter history

3. **Clinical Documentation**
   - SOAP note editor with AI assistance
   - Voice-to-text transcription integration
   - Document templates
   - AI-powered documentation improvement

4. **Orders & Results**
   - Lab orders with AI suggestions
   - Imaging orders
   - Results viewing
   - Result trending/graphing

5. **Medications**
   - Medication list management
   - Prescription writing
   - Drug interaction checking (AI)
   - Refill management

6. **Problem List & Diagnoses**
   - Active problem list
   - Diagnosis history
   - AI-powered diagnosis suggestions

7. **Allergies**
   - Allergy documentation
   - Severity levels
   - Cross-reactivity warnings

### AI-Specific Features
1. **AI Scribe Integration**
   - View transcripts and SOAP notes from AI scribe sessions
   - Audio playback for recorded sessions
   - Edit and approve AI-generated documentation

2. **Semantic Search**
   - Natural language search across patient records
   - Find similar cases
   - Clinical query answering

3. **Clinical Decision Support**
   - AI recommendations panel
   - Drug interaction alerts
   - Diagnosis suggestions
   - Treatment recommendations

4. **Smart Documentation**
   - AI-assisted note writing
   - Auto-summarization
   - Documentation quality suggestions

5. **Billing Assistance**
   - AI-suggested billing codes
   - Code validation
   - Documentation-to-code matching

6. **Approval Workflow**
   - Pending approvals dashboard
   - Approve/reject AI actions
   - Audit trail viewing

### Administrative Features
1. **Scheduling** (if implementing)
2. **User management**
3. **Practice settings**
4. **Reporting/Analytics**

---

## Technical Recommendations

### Flutter Packages
- `http` or `dio` - HTTP client
- `flutter_secure_storage` - Secure token storage
- `provider` or `riverpod` - State management
- `go_router` - Navigation
- `flutter_markdown` - Rendering clinical notes
- `audioplayers` - Audio playback for recordings
- `intl` - Date/time formatting

### Architecture Patterns
- Clean Architecture or similar layered approach
- Repository pattern for data access
- Use cases for business logic
- Proper error handling for network failures

### FHIR Considerations
- Consider using a FHIR client library
- Handle pagination for large result sets
- Implement proper resource versioning
- Cache frequently accessed resources

---

## API Endpoints Reference

### FHIR Operations
```
GET    /fhir/R4/{ResourceType}              - Search resources
GET    /fhir/R4/{ResourceType}/{id}         - Read resource
POST   /fhir/R4/{ResourceType}              - Create resource
PUT    /fhir/R4/{ResourceType}/{id}         - Update resource
DELETE /fhir/R4/{ResourceType}/{id}         - Delete resource
```

### Common Queries
```
GET /fhir/R4/Patient?name=John
GET /fhir/R4/Encounter?patient=Patient/{id}
GET /fhir/R4/DocumentReference?encounter=Encounter/{id}
GET /fhir/R4/Observation?patient=Patient/{id}&category=vital-signs
```

### Bot Invocation
Bots are triggered via Medplum's subscription/bot system. The frontend typically:
1. Creates a resource that triggers the bot
2. Polls for or receives the result
3. Displays the AI output to the user

---

## Important Notes

1. **HIPAA Compliance**: All PHI must be handled securely. Use HTTPS, secure storage, and proper access controls.

2. **Encounter ID Pattern**: When creating resources that reference an Encounter, always use the server-returned ID from the POST response, not pre-generated UUIDs.

3. **Error Handling**: The backend may return FHIR OperationOutcome resources for errors. Parse and display these appropriately.

4. **Offline Capability**: Consider offline-first architecture for clinical workflows.

5. **Performance**: Clinical users expect fast response times. Implement proper caching and loading states.

---

## Getting Started

1. Set up Flutter development environment
2. Create new Flutter project (separate from backend repo)
3. Implement OAuth 2.0 PKCE authentication
4. Create FHIR client service
5. Build core UI components
6. Implement patient search and display
7. Add encounter management
8. Integrate AI features one by one
9. Add remaining clinical workflows
10. Implement admin features

The backend is fully functional at `localhost:8103`. Use the existing test user `admin@example.com` with password `medplum_admin` for development.
