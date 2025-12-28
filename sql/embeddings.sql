-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Clinical embeddings table for RAG/semantic search
CREATE TABLE IF NOT EXISTS clinical_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FHIR resource reference
  fhir_resource_type VARCHAR(100) NOT NULL,
  fhir_resource_id UUID NOT NULL,

  -- Content metadata
  content_type VARCHAR(50) NOT NULL,  -- 'note', 'condition', 'medication', 'observation', etc.
  content_section VARCHAR(100),        -- 'chief_complaint', 'assessment', 'plan', etc.
  chunk_index INTEGER DEFAULT 0,       -- For documents split into chunks

  -- The actual text content
  content_text TEXT NOT NULL,

  -- Vector embedding (1536 for OpenAI ada-002, 768 for local models)
  -- Using 768 for local models like nomic-embed-text
  embedding VECTOR(768),

  -- Provenance tracking
  model_version VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Patient reference for access control
  patient_id UUID,

  -- Unique constraint to prevent duplicates
  UNIQUE(fhir_resource_id, chunk_index)
);

-- Index for vector similarity search (IVFFlat for medium datasets)
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_vector
ON clinical_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for filtering by resource type
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_resource_type
ON clinical_embeddings (fhir_resource_type);

-- Index for filtering by patient
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_patient
ON clinical_embeddings (patient_id);

-- Index for filtering by content type
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_content_type
ON clinical_embeddings (content_type);

-- Compound index for common queries
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_patient_type
ON clinical_embeddings (patient_id, content_type);

-- AI Command queue table (for human-in-the-loop approvals)
CREATE TABLE IF NOT EXISTS ai_command_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Command details
  command_type VARCHAR(100) NOT NULL,
  command_payload JSONB NOT NULL,

  -- AI metadata
  ai_model VARCHAR(100) NOT NULL,
  ai_confidence DECIMAL(5,4),
  ai_reasoning TEXT,

  -- Target resource
  target_resource_type VARCHAR(100),
  target_resource_id UUID,
  patient_id UUID,

  -- Approval workflow
  status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected, expired
  requires_approval BOOLEAN DEFAULT true,
  approver_role VARCHAR(100),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,

  -- Reviewer info
  reviewed_by UUID,  -- Practitioner ID
  reviewer_notes TEXT,

  -- Audit trail
  executed_at TIMESTAMPTZ,
  execution_result JSONB
);

-- Index for pending commands
CREATE INDEX IF NOT EXISTS idx_ai_commands_pending
ON ai_command_queue (status, created_at)
WHERE status = 'pending';

-- Index for patient-specific commands
CREATE INDEX IF NOT EXISTS idx_ai_commands_patient
ON ai_command_queue (patient_id, status);

-- AI audit log table
CREATE TABLE IF NOT EXISTS ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request details
  request_id UUID NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  prompt_hash VARCHAR(64),  -- SHA-256 of prompt (for privacy)
  prompt_tokens INTEGER,

  -- Response details
  response_hash VARCHAR(64),
  completion_tokens INTEGER,
  total_tokens INTEGER,

  -- Timing
  request_timestamp TIMESTAMPTZ NOT NULL,
  response_timestamp TIMESTAMPTZ,
  latency_ms INTEGER,

  -- Metadata
  user_id UUID,
  patient_id UUID,  -- If patient-specific
  bot_id UUID,      -- Medplum bot that made the request

  -- PHI handling
  phi_detected BOOLEAN DEFAULT false,
  phi_redacted BOOLEAN DEFAULT false,
  routing_decision VARCHAR(20),  -- 'local', 'cloud', 'blocked'

  -- Cost tracking
  estimated_cost_usd DECIMAL(10,6),

  -- Error handling
  error_occurred BOOLEAN DEFAULT false,
  error_message TEXT,

  -- Guardrail results
  safety_filters_triggered JSONB
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_ai_audit_timestamp
ON ai_audit_log (request_timestamp DESC);

-- Index for user-specific audits
CREATE INDEX IF NOT EXISTS idx_ai_audit_user
ON ai_audit_log (user_id, request_timestamp DESC);

-- Index for patient-specific audits
CREATE INDEX IF NOT EXISTS idx_ai_audit_patient
ON ai_audit_log (patient_id, request_timestamp DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for embeddings table
DROP TRIGGER IF EXISTS update_clinical_embeddings_updated_at ON clinical_embeddings;
CREATE TRIGGER update_clinical_embeddings_updated_at
  BEFORE UPDATE ON clinical_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Helper function for semantic search
CREATE OR REPLACE FUNCTION semantic_search(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter_patient_id UUID DEFAULT NULL,
  filter_content_type VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  fhir_resource_type VARCHAR,
  fhir_resource_id UUID,
  content_type VARCHAR,
  content_text TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id,
    ce.fhir_resource_type,
    ce.fhir_resource_id,
    ce.content_type,
    ce.content_text,
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM clinical_embeddings ce
  WHERE
    (filter_patient_id IS NULL OR ce.patient_id = filter_patient_id)
    AND (filter_content_type IS NULL OR ce.content_type = filter_content_type)
    AND 1 - (ce.embedding <=> query_embedding) > match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL ON clinical_embeddings TO medplum;
-- GRANT ALL ON ai_command_queue TO medplum;
-- GRANT ALL ON ai_audit_log TO medplum;

COMMENT ON TABLE clinical_embeddings IS 'Vector embeddings for clinical documents enabling semantic search and RAG';
COMMENT ON TABLE ai_command_queue IS 'Queue for AI-suggested actions awaiting human approval';
COMMENT ON TABLE ai_audit_log IS 'Comprehensive audit log of all AI/LLM interactions';
COMMENT ON FUNCTION semantic_search IS 'Perform semantic similarity search over clinical embeddings';
