# Medplum AI Bots API Reference

Complete API documentation for all AI bots in the Medplum AI stack.

## Table of Contents

- [Embedding Bot](#embedding-bot)
- [Semantic Search Bot](#semantic-search-bot)
- [RAG Pipeline Bot](#rag-pipeline-bot)
- [Command Processor Bot](#command-processor-bot)
- [Approval Queue Bot](#approval-queue-bot)
- [Clinical Decision Support Bot](#clinical-decision-support-bot)
- [Documentation Assistant Bot](#documentation-assistant-bot)
- [Billing Code Suggester Bot](#billing-code-suggester-bot)
- [Audit Logging Bot](#audit-logging-bot)

---

## Embedding Bot

Creates vector embeddings for FHIR resources to enable semantic search.

### Trigger

Medplum Subscription on resource create/update for:
- DiagnosticReport
- Observation
- Condition
- DocumentReference
- MedicationRequest

### Input

The bot receives the FHIR resource directly via subscription:

```typescript
interface EmbeddingBotInput {
  resourceType: string;
  id: string;
  // ... full FHIR resource
}
```

### Output

```typescript
interface EmbeddingBotOutput {
  success: boolean;
  resourceType: string;
  resourceId: string;
  embeddingsCreated: number;
  chunksProcessed: number;
  skipped?: boolean;  // True if resource type not supported
  message?: string;   // Error message if failed
}
```

### Example

```typescript
// Input (Condition resource)
{
  resourceType: "Condition",
  id: "condition-123",
  subject: { reference: "Patient/patient-456" },
  code: {
    coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10" }],
    text: "Essential hypertension"
  }
}

// Output
{
  success: true,
  resourceType: "Condition",
  resourceId: "condition-123",
  embeddingsCreated: 1,
  chunksProcessed: 1
}
```

### Storage

Embeddings are stored as Binary resources with JSON content:

```typescript
interface StoredEmbedding {
  type: "clinical_embedding";
  fhir_resource_type: string;
  fhir_resource_id: string;
  patient_id: string;
  content_type: string;
  content_text: string;
  embedding: number[];  // 768 dimensions
  model_version: string;
  created_at: string;
}
```

---

## Semantic Search Bot

Performs vector similarity search across embedded clinical data.

### Input

```typescript
interface SemanticSearchInput {
  query: string;                    // Required: search query
  patientId?: string;               // Filter by patient
  resourceTypes?: string[];         // Filter by FHIR resource types
  limit?: number;                   // Max results (default: 10)
  minSimilarity?: number;           // Minimum similarity threshold (0-1)
  dateRange?: {
    start: string;                  // ISO date
    end: string;
  };
  includeSnippets?: boolean;        // Include matched text
}
```

### Output

```typescript
interface SemanticSearchOutput {
  success: boolean;
  results: SearchResult[];
  queryEmbeddingGenerated: boolean;
  searchDurationMs: number;
  message?: string;
}

interface SearchResult {
  resourceType: string;
  resourceId: string;
  similarity: number;           // 0-1 score
  matchedText?: string;         // If includeSnippets: true
  patientId?: string;
}
```

### Example

```typescript
// Input
{
  query: "uncontrolled blood pressure readings",
  patientId: "patient-456",
  resourceTypes: ["Observation"],
  limit: 5,
  minSimilarity: 0.7
}

// Output
{
  success: true,
  results: [
    {
      resourceType: "Observation",
      resourceId: "obs-789",
      similarity: 0.92,
      matchedText: "Blood pressure 180/110 mmHg - significantly elevated",
      patientId: "patient-456"
    }
  ],
  queryEmbeddingGenerated: true,
  searchDurationMs: 145
}
```

---

## RAG Pipeline Bot

Answers clinical questions using retrieved context and LLM generation.

### Input

```typescript
interface RAGPipelineInput {
  question: string;                 // Required: clinical question
  patientId: string;                // Required: patient context
  maxContextChunks?: number;        // Max context pieces (default: 5)
  includeCitations?: boolean;       // Include source citations
  model?: string;                   // LLM model (default: llama3.2:3b)
  temperature?: number;             // 0-1 (default: 0.3)
  maxTokens?: number;               // Max response tokens
  questionType?: "factual" | "trend" | "summary" | "comparison";
}
```

### Output

```typescript
interface RAGPipelineOutput {
  success: boolean;
  answer: string;
  confidence: number;               // 0-1 confidence score
  contextUsed: ContextChunk[];
  citations?: Citation[];
  modelUsed: string;
  tokensUsed: number;
  retrievalTimeMs: number;
  generationTimeMs: number;
  totalTimeMs: number;
  message?: string;
}

interface ContextChunk {
  sourceReference: string;          // FHIR reference
  sourceType: string;               // Resource type
  text: string;
  similarity: number;
}

interface Citation {
  text: string;
  source: string;
  date?: string;
}
```

### Example

```typescript
// Input
{
  question: "What is this patient's HbA1c trend over the past year?",
  patientId: "patient-456",
  includeCitations: true,
  questionType: "trend"
}

// Output
{
  success: true,
  answer: "The patient's HbA1c has shown steady improvement over the past year, decreasing from 8.2% (Jan 2024) to 7.1% (Dec 2024). This 1.1% reduction indicates effective diabetes management.",
  confidence: 0.89,
  contextUsed: [
    {
      sourceReference: "Observation/hba1c-jan",
      sourceType: "Observation",
      text: "HbA1c: 8.2%",
      similarity: 0.94
    },
    {
      sourceReference: "Observation/hba1c-dec",
      sourceType: "Observation",
      text: "HbA1c: 7.1%",
      similarity: 0.93
    }
  ],
  citations: [
    { text: "HbA1c 8.2%", source: "Observation/hba1c-jan", date: "2024-01-15" },
    { text: "HbA1c 7.1%", source: "Observation/hba1c-dec", date: "2024-12-10" }
  ],
  modelUsed: "llama3.2:3b",
  tokensUsed: 256,
  retrievalTimeMs: 120,
  generationTimeMs: 850,
  totalTimeMs: 970
}
```

---

## Command Processor Bot

Validates, filters, and routes AI-generated commands.

### Input

```typescript
type AICommand =
  | FlagAbnormalResult
  | CreateEncounterNoteDraft
  | ProposeProblemListUpdate
  | SuggestBillingCodes
  | QueueReferralLetter
  | SuggestMedicationChange
  | SummarizePatientHistory;

interface AICommandBase {
  command: string;
  confidence: number;               // 0-1 confidence score
  requiresApproval: boolean;
  aiModel: string;
  createdAt?: string;
}
```

### Command Types

#### FlagAbnormalResult

```typescript
interface FlagAbnormalResult extends AICommandBase {
  command: "FlagAbnormalResult";
  patientId: string;
  observationId: string;
  severity: "low" | "medium" | "high" | "critical";
  interpretation: string;
}
```

#### CreateEncounterNoteDraft

```typescript
interface CreateEncounterNoteDraft extends AICommandBase {
  command: "CreateEncounterNoteDraft";
  patientId: string;
  encounterId: string;
  noteType: "progress" | "discharge" | "consultation";
  content: string;
}
```

#### ProposeProblemListUpdate

```typescript
interface ProposeProblemListUpdate extends AICommandBase {
  command: "ProposeProblemListUpdate";
  patientId: string;
  action: "add" | "resolve" | "update";
  condition: {
    code: string;
    system: string;
    display: string;
  };
  clinicalStatus?: string;
  reasoning?: string;
}
```

#### SuggestBillingCodes

```typescript
interface SuggestBillingCodes extends AICommandBase {
  command: "SuggestBillingCodes";
  patientId: string;
  encounterId: string;
  suggestedCodes: Array<{
    code: string;
    system: "CPT" | "ICD-10-CM";
    display: string;
    confidence: number;
  }>;
}
```

### Output

```typescript
interface CommandProcessorOutput {
  success: boolean;
  action: "executed" | "queued" | "blocked";
  commandId: string;
  taskId?: string;              // If queued for approval
  executedResourceId?: string;  // If executed
  blockReason?: string;         // If blocked
  warnings?: string[];
  message?: string;
}
```

### Safety Filters

Commands are blocked if:
- Confidence < 0.5
- Command type is in blocked list
- Outside allowed hours (configurable)
- Attempts to modify allergies or order controlled substances

---

## Approval Queue Bot

Processes approval workflow for AI commands requiring human verification.

### Input

```typescript
// FHIR Task resource with AI command
interface ApprovalQueueInput {
  resourceType: "Task";
  id: string;
  status: "requested" | "completed" | "rejected" | "failed";
  intent: "order";
  code: {
    coding: [{ system: "http://medplum.com/ai-command", code: string }]
  };
  owner?: { reference: string };    // Approver (Practitioner)
  for?: { reference: string };      // Patient
  restriction?: {
    period: { end: string };        // Expiration
  };
  input: [{
    type: { text: "command" };
    valueString: string;            // JSON-encoded command
  }];
  output?: [{
    type: { text: "modifications" };
    valueString: string;            // Modified command JSON
  }];
  note?: [{ text: string }];        // Rejection reason
}
```

### Output

```typescript
interface ApprovalQueueOutput {
  success: boolean;
  action: "pending" | "approved" | "rejected" | "expired";
  executedResourceId?: string;      // Created resource ID
  message: string;
}
```

### Workflow States

1. **Pending** (`status: "requested"`)
   - Task awaits clinician review
   - Expires after configured timeout

2. **Approved** (`status: "completed"`)
   - Command is executed
   - DocumentReference/Condition/etc. created
   - Provenance recorded

3. **Rejected** (`status: "rejected"`)
   - Command not executed
   - Rejection reason in `note`
   - Provenance recorded

4. **Expired** (`restriction.period.end` passed)
   - Task marked as failed
   - No action taken

---

## Clinical Decision Support Bot

Analyzes patient data for clinical insights and recommendations.

### Input

```typescript
interface CDSInput {
  patientId: string;
  analysisTypes: ("diagnosis" | "interactions" | "preventive" | "critical" | "all")[];
  generateCommands?: boolean;       // Generate AI commands for findings
}
```

### Output

```typescript
interface CDSOutput {
  success: boolean;
  diagnosisSuggestions?: DiagnosisSuggestion[];
  medicationInteractions?: MedicationInteraction[];
  preventiveCareGaps?: PreventiveCareGap[];
  criticalFlags?: CriticalFlag[];
  commands?: AICommand[];           // If generateCommands: true
  overallConfidence: number;
  message?: string;
}

interface DiagnosisSuggestion {
  condition: {
    code: string;
    display: string;
  };
  confidence: number;
  reasoning: string;
  supportingEvidence: string[];
}

interface MedicationInteraction {
  medications: string[];
  severity: "minor" | "moderate" | "major" | "contraindicated";
  description: string;
  recommendation: string;
}

interface PreventiveCareGap {
  screening: string;
  lastPerformed?: string;
  dueDate: string;
  recommendation: string;
}

interface CriticalFlag {
  finding: string;
  severity: "low" | "medium" | "high" | "critical";
  sourceReference: string;
  recommendation: string;
}
```

---

## Documentation Assistant Bot

Generates clinical documentation from patient data.

### Input

```typescript
interface DocAssistantInput {
  patientId: string;
  encounterId: string;
  documentationType: "progress" | "discharge" | "consultation" | "referral" | "history_physical";
  format?: "soap" | "narrative";
  saveDraft?: boolean;
  clinicianInput?: {
    chiefComplaint?: string;
    physicalExam?: string;
    assessment?: string;
    plan?: string;
  };
  includeMedications?: boolean;
  includeVitals?: boolean;
  includeLabResults?: boolean;
  referralDetails?: {
    specialty: string;
    urgency: "routine" | "urgent" | "stat";
  };
}
```

### Output

```typescript
interface DocAssistantOutput {
  success: boolean;
  documentType: string;
  content: string;
  sections?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  };
  draftId?: string;                 // DocumentReference ID if saved
  confidence: number;
  warnings?: string[];
  contextSourcesUsed: string[];
  medicationsIncluded?: boolean;
  message?: string;
}
```

---

## Billing Code Suggester Bot

Suggests appropriate CPT and ICD-10 billing codes.

### Input

```typescript
interface BillingSuggesterInput {
  patientId: string;
  encounterId: string;
  generateCommand?: boolean;
  validateCodes?: boolean;
  includeModifiers?: boolean;
  checkBundling?: boolean;
  checkDocumentation?: boolean;
  includeHistoricalAnalysis?: boolean;
  minConfidence?: number;
}
```

### Output

```typescript
interface BillingSuggesterOutput {
  success: boolean;
  cptCodes: CPTSuggestion[];
  icd10Codes: ICD10Suggestion[];
  modifiers?: Modifier[];
  command?: SuggestBillingCodes;
  codesValidated?: boolean;
  bundlingAlerts?: BundlingAlert[];
  documentationGaps?: DocumentationGap[];
  historicalAnalysis?: HistoricalAnalysis;
  medicalNecessityWarnings?: string[];
  warnings?: string[];
  message?: string;
}

interface CPTSuggestion {
  code: string;
  display: string;
  confidence: number;
  rationale: string;
  supportingDiagnoses: string[];
}

interface ICD10Suggestion {
  code: string;
  display: string;
  confidence: number;
  isPrimary: boolean;
  supportingDocumentation?: string;
}

interface DocumentationGap {
  issue: string;
  requiredFor: string;
  suggestion: string;
}
```

---

## Audit Logging Bot

Creates comprehensive audit trail for all AI operations.

### Input

```typescript
interface AuditLogInput {
  eventType: AuditEventType;
  action: "C" | "R" | "U" | "D" | "E";  // Create, Read, Update, Delete, Execute
  outcome: "0" | "4" | "8" | "12";      // Success, Minor Failure, Serious Failure, Major Failure
  commandId?: string;
  commandType?: string;
  patientId?: string;
  practitionerId?: string;
  aiModel?: string;
  confidence?: number;
  prompt?: string;
  response?: string;
  blockReason?: string;
  safetyFilter?: string;
  duration?: number;
  tokensUsed?: number;
  outcomeDesc?: string;
}

type AuditEventType =
  | "command_received"
  | "command_executed"
  | "command_blocked"
  | "command_queued"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "approval_timeout"
  | "safety_filter_triggered"
  | "embedding_created"
  | "semantic_search"
  | "rag_query"
  | "llm_request"
  | "llm_response"
  | "phi_redaction"
  | "rate_limit_exceeded"
  | "error";
```

### Output

```typescript
interface AuditLogOutput {
  success: boolean;
  auditEventId: string;
  message?: string;
}
```

### Helper Functions

```typescript
// Log single event
async function logAIAuditEvent(
  medplum: MedplumClient,
  eventType: AuditEventType,
  details: Partial<AuditLogInput>
): Promise<string>;

// Log batch of events
async function logAIAuditEventBatch(
  medplum: MedplumClient,
  events: AuditLogInput[]
): Promise<string[]>;
```

---

## Error Handling

All bots follow consistent error handling:

```typescript
interface ErrorResponse {
  success: false;
  message: string;
  errorCode?: string;
  details?: any;
}
```

Common error codes:
- `INVALID_INPUT` - Missing or invalid input parameters
- `PATIENT_NOT_FOUND` - Patient ID not found
- `LLM_ERROR` - Error communicating with Ollama
- `EMBEDDING_ERROR` - Failed to generate embeddings
- `SAFETY_BLOCKED` - Command blocked by safety filter
- `TIMEOUT` - Operation timed out
- `UNAUTHORIZED` - Insufficient permissions
