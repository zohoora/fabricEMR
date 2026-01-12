/**
 * Embedding Bot
 *
 * Automatically generates vector embeddings when clinical resources are created or updated.
 * Supports: DiagnosticReport, DocumentReference, Observation, Condition, MedicationStatement,
 *           ClinicalImpression, Procedure, AllergyIntolerance
 *
 * Trigger: FHIR Subscription on resource create/update
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import {
  Resource,
  DiagnosticReport,
  DocumentReference,
  Observation,
  Condition,
  MedicationStatement,
  ClinicalImpression,
  Procedure,
  AllergyIntolerance,
  Binary,
} from '@medplum/fhirtypes';
import {
  generateEmbedding as llmGenerateEmbedding,
  config as llmConfig,
} from './services/llm-client';

const CHUNK_SIZE = 500; // Characters per chunk
const CHUNK_OVERLAP = 50; // Overlap between chunks

// Supported resource types for embedding
const EMBEDDABLE_TYPES = [
  'DiagnosticReport',
  'DocumentReference',
  'Observation',
  'Condition',
  'MedicationStatement',
  'ClinicalImpression',
  'Procedure',
  'AllergyIntolerance',
];

interface EmbeddingRecord {
  fhir_resource_type: string;
  fhir_resource_id: string;
  content_type: string;
  content_section?: string;
  chunk_index: number;
  content_text: string;
  embedding: number[];
  model_version: string;
  patient_id?: string;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const resource = event.input as Resource;

  if (!resource || !resource.resourceType || !resource.id) {
    return { success: false, error: 'Invalid resource' };
  }

  if (!EMBEDDABLE_TYPES.includes(resource.resourceType)) {
    return { success: false, error: `Resource type ${resource.resourceType} not supported for embedding` };
  }

  console.log(`Processing ${resource.resourceType}/${resource.id} for embedding`);

  try {
    // Extract text content from the resource
    const textContent = await extractTextContent(medplum, resource);

    if (!textContent || textContent.text.length === 0) {
      return { success: false, error: 'No text content to embed' };
    }

    // Chunk the text if it's long
    const chunks = chunkText(textContent.text, CHUNK_SIZE, CHUNK_OVERLAP);

    // Generate embeddings for each chunk
    const embeddings: EmbeddingRecord[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);

      if (embedding) {
        embeddings.push({
          fhir_resource_type: resource.resourceType,
          fhir_resource_id: resource.id,
          content_type: textContent.contentType,
          content_section: textContent.section,
          chunk_index: i,
          content_text: chunks[i],
          embedding: embedding,
          model_version: llmConfig.embeddingModel,
          patient_id: textContent.patientId,
        });
      }
    }

    // Store embeddings in database
    const stored = await storeEmbeddings(medplum, embeddings);

    console.log(`Stored ${stored} embeddings for ${resource.resourceType}/${resource.id}`);

    return {
      success: true,
      resourceType: resource.resourceType,
      resourceId: resource.id,
      chunksProcessed: chunks.length,
      embeddingsStored: stored,
    };
  } catch (error) {
    console.log('Error processing resource for embedding:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Extract text content from a FHIR resource
 */
async function extractTextContent(
  medplum: MedplumClient,
  resource: Resource
): Promise<{ text: string; contentType: string; section?: string; patientId?: string } | null> {
  const patientId = getPatientId(resource);

  switch (resource.resourceType) {
    case 'DiagnosticReport': {
      const report = resource as DiagnosticReport;
      const texts: string[] = [];

      if (report.conclusion) {
        texts.push(`Conclusion: ${report.conclusion}`);
      }

      if (report.presentedForm) {
        for (const attachment of report.presentedForm) {
          if (attachment.data) {
            const decoded = Buffer.from(attachment.data, 'base64').toString('utf-8');
            texts.push(decoded);
          }
        }
      }

      // Include coded diagnoses
      if (report.conclusionCode) {
        for (const code of report.conclusionCode) {
          if (code.text) {
            texts.push(`Diagnosis: ${code.text}`);
          }
        }
      }

      return {
        text: texts.join('\n\n'),
        contentType: 'diagnostic_report',
        section: report.category?.[0]?.text || 'general',
        patientId,
      };
    }

    case 'DocumentReference': {
      const doc = resource as DocumentReference;
      const texts: string[] = [];

      if (doc.description) {
        texts.push(`Description: ${doc.description}`);
      }

      if (doc.content) {
        for (const content of doc.content) {
          if (content.attachment?.data) {
            const decoded = Buffer.from(content.attachment.data, 'base64').toString('utf-8');
            texts.push(decoded);
          }
        }
      }

      return {
        text: texts.join('\n\n'),
        contentType: 'document',
        section: doc.type?.text || 'clinical_note',
        patientId,
      };
    }

    case 'Observation': {
      const obs = resource as Observation;
      const texts: string[] = [];

      const obsName = obs.code?.text || obs.code?.coding?.[0]?.display || 'Unknown observation';
      texts.push(`Observation: ${obsName}`);

      if (obs.valueString) {
        texts.push(`Value: ${obs.valueString}`);
      } else if (obs.valueQuantity) {
        texts.push(`Value: ${obs.valueQuantity.value} ${obs.valueQuantity.unit}`);
      } else if (obs.valueCodeableConcept) {
        texts.push(`Value: ${obs.valueCodeableConcept.text || obs.valueCodeableConcept.coding?.[0]?.display}`);
      }

      if (obs.interpretation) {
        texts.push(`Interpretation: ${obs.interpretation[0]?.text || obs.interpretation[0]?.coding?.[0]?.display}`);
      }

      if (obs.note) {
        for (const note of obs.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'observation',
        section: obs.category?.[0]?.coding?.[0]?.code || 'vital-signs',
        patientId,
      };
    }

    case 'Condition': {
      const condition = resource as Condition;
      const texts: string[] = [];

      const conditionName = condition.code?.text || condition.code?.coding?.[0]?.display || 'Unknown condition';
      texts.push(`Condition: ${conditionName}`);

      if (condition.clinicalStatus) {
        texts.push(`Status: ${condition.clinicalStatus.coding?.[0]?.code}`);
      }

      if (condition.severity) {
        texts.push(`Severity: ${condition.severity.text || condition.severity.coding?.[0]?.display}`);
      }

      if (condition.note) {
        for (const note of condition.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'condition',
        section: condition.category?.[0]?.coding?.[0]?.code || 'problem-list',
        patientId,
      };
    }

    case 'MedicationStatement': {
      const med = resource as MedicationStatement;
      const texts: string[] = [];

      if (med.medicationCodeableConcept) {
        texts.push(`Medication: ${med.medicationCodeableConcept.text || med.medicationCodeableConcept.coding?.[0]?.display}`);
      }

      if (med.dosage) {
        for (const dose of med.dosage) {
          if (dose.text) {
            texts.push(`Dosage: ${dose.text}`);
          }
        }
      }

      if (med.note) {
        for (const note of med.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'medication',
        section: 'medications',
        patientId,
      };
    }

    case 'ClinicalImpression': {
      const impression = resource as ClinicalImpression;
      const texts: string[] = [];

      if (impression.description) {
        texts.push(`Clinical Impression: ${impression.description}`);
      }

      if (impression.summary) {
        texts.push(`Summary: ${impression.summary}`);
      }

      if (impression.finding) {
        for (const finding of impression.finding) {
          if (finding.itemCodeableConcept?.text) {
            texts.push(`Finding: ${finding.itemCodeableConcept.text}`);
          } else if (finding.itemCodeableConcept?.coding?.[0]?.display) {
            texts.push(`Finding: ${finding.itemCodeableConcept.coding[0].display}`);
          }
        }
      }

      if (impression.note) {
        for (const note of impression.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'clinical_impression',
        section: 'assessments',
        patientId,
      };
    }

    case 'Procedure': {
      const procedure = resource as Procedure;
      const texts: string[] = [];

      const procedureName = procedure.code?.text || procedure.code?.coding?.[0]?.display || 'Unknown procedure';
      texts.push(`Procedure: ${procedureName}`);

      if (procedure.status) {
        texts.push(`Status: ${procedure.status}`);
      }

      if (procedure.outcome?.text) {
        texts.push(`Outcome: ${procedure.outcome.text}`);
      }

      if (procedure.complication) {
        for (const complication of procedure.complication) {
          if (complication.text) {
            texts.push(`Complication: ${complication.text}`);
          }
        }
      }

      if (procedure.note) {
        for (const note of procedure.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'procedure',
        section: 'procedures',
        patientId,
      };
    }

    case 'AllergyIntolerance': {
      const allergy = resource as AllergyIntolerance;
      const texts: string[] = [];

      const allergyName = allergy.code?.text || allergy.code?.coding?.[0]?.display || 'Unknown allergen';
      texts.push(`Allergy/Intolerance: ${allergyName}`);

      if (allergy.clinicalStatus) {
        texts.push(`Status: ${allergy.clinicalStatus.coding?.[0]?.code}`);
      }

      if (allergy.type) {
        texts.push(`Type: ${allergy.type}`);
      }

      if (allergy.criticality) {
        texts.push(`Criticality: ${allergy.criticality}`);
      }

      if (allergy.reaction) {
        for (const reaction of allergy.reaction) {
          if (reaction.manifestation) {
            const manifestations = reaction.manifestation
              .map(m => m.text || m.coding?.[0]?.display)
              .filter(Boolean)
              .join(', ');
            if (manifestations) {
              texts.push(`Reaction: ${manifestations}`);
            }
          }
          if (reaction.severity) {
            texts.push(`Severity: ${reaction.severity}`);
          }
        }
      }

      if (allergy.note) {
        for (const note of allergy.note) {
          if (note.text) {
            texts.push(`Note: ${note.text}`);
          }
        }
      }

      return {
        text: texts.join('\n'),
        contentType: 'allergy',
        section: 'allergies',
        patientId,
      };
    }

    default:
      return null;
  }
}

/**
 * Get patient ID from resource
 */
function getPatientId(resource: Resource): string | undefined {
  const anyResource = resource as any;

  if (anyResource.subject?.reference) {
    const ref = anyResource.subject.reference as string;
    if (ref.startsWith('Patient/')) {
      return ref.replace('Patient/', '');
    }
  }

  if (anyResource.patient?.reference) {
    const ref = anyResource.patient.reference as string;
    if (ref.startsWith('Patient/')) {
      return ref.replace('Patient/', '');
    }
  }

  return undefined;
}

/**
 * Chunk text into smaller pieces with overlap
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > start + chunkSize / 2) {
        end = breakPoint + 1;
      }
    }

    chunks.push(text.slice(start, Math.min(end, text.length)).trim());
    start = end - overlap;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Generate embedding using LLM Router (OpenAI-compatible API)
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const result = await llmGenerateEmbedding(text, 'embedding', {
      botName: 'embedding-bot',
    });
    return result.embedding;
  } catch (error) {
    console.log('Error generating embedding:', error);
    return null;
  }
}

/**
 * Store embeddings in PostgreSQL via direct query
 * Note: In production, use a proper database connection pool
 */
async function storeEmbeddings(medplum: MedplumClient, embeddings: EmbeddingRecord[]): Promise<number> {
  // For now, store as Binary resources with embedding metadata
  // In production, you would use a direct PostgreSQL connection

  let stored = 0;

  for (const embedding of embeddings) {
    try {
      // Create a Binary resource to store the embedding
      // This is a workaround - ideally use direct DB access
      const binary = await medplum.createResource<Binary>({
        resourceType: 'Binary',
        contentType: 'application/json',
        data: Buffer.from(
          JSON.stringify({
            type: 'clinical_embedding',
            ...embedding,
          })
        ).toString('base64'),
      });

      if (binary.id) {
        stored++;
      }
    } catch (error) {
      console.log('Error storing embedding:', error);
    }
  }

  return stored;
}

export default handler;
