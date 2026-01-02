-- PostgreSQL initialization script for FabricEMR
-- Creates additional databases and extensions needed by the platform

-- Create litellm database for LLM Gateway logging and rate limiting
SELECT 'CREATE DATABASE litellm'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec

-- Connect to litellm database and create extensions
\c litellm

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Connect back to medplum database
\c medplum

-- Enable pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Create clinical embeddings table for semantic search
CREATE TABLE IF NOT EXISTS clinical_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fhir_resource_type VARCHAR(64) NOT NULL,
    fhir_resource_id VARCHAR(64) NOT NULL,
    content_type VARCHAR(64) NOT NULL,
    content_section VARCHAR(128),
    chunk_index INTEGER DEFAULT 0,
    content_text TEXT NOT NULL,
    embedding vector(768),  -- nomic-embed-text produces 768-dimensional vectors
    model_version VARCHAR(64) NOT NULL,
    patient_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Indexes for efficient querying
    CONSTRAINT unique_chunk UNIQUE (fhir_resource_type, fhir_resource_id, chunk_index)
);

-- Create index for vector similarity search (IVFFlat for performance)
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_vector
ON clinical_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create indexes for filtering
CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_patient
ON clinical_embeddings (patient_id);

CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_resource
ON clinical_embeddings (fhir_resource_type, fhir_resource_id);

CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_content_type
ON clinical_embeddings (content_type);

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS trigger_clinical_embeddings_updated_at ON clinical_embeddings;
CREATE TRIGGER trigger_clinical_embeddings_updated_at
    BEFORE UPDATE ON clinical_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Grant permissions to medplum user
GRANT ALL PRIVILEGES ON TABLE clinical_embeddings TO medplum;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medplum;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'FabricEMR PostgreSQL initialization completed successfully';
END $$;
