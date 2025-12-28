/**
 * RAG Pipeline Bot
 *
 * Retrieval-Augmented Generation pipeline for clinical Q&A.
 * Retrieves relevant context from patient records and generates grounded responses.
 *
 * Input: { question: string, patientId: string, context?: string }
 * Output: { answer: string, sources: string[], confidence: number }
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import { Patient, Condition, Observation, MedicationStatement } from '@medplum/fhirtypes';

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const MAX_CONTEXT_LENGTH = 4000;
const TOP_K_RESULTS = 5;

interface RAGInput {
  question: string;
  patientId: string;
  additionalContext?: string;
  includeHistory?: boolean;
}

interface RAGOutput {
  success: boolean;
  question: string;
  answer: string;
  sources: Array<{
    resourceType: string;
    resourceId: string;
    excerpt: string;
    relevance: number;
  }>;
  confidence: number;
  model: string;
  tokensUsed?: number;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<RAGOutput> {
  const input = event.input as RAGInput;

  if (!input?.question || !input?.patientId) {
    return {
      success: false,
      question: input?.question || '',
      answer: 'Error: Both question and patientId are required',
      sources: [],
      confidence: 0,
      model: LLM_MODEL,
    };
  }

  console.log(`RAG query for patient ${input.patientId}: "${input.question.substring(0, 50)}..."`);

  try {
    // Step 1: Retrieve patient context
    const patientContext = await gatherPatientContext(medplum, input.patientId);

    // Step 2: Semantic search for relevant documents
    const relevantDocs = await semanticSearch(medplum, input.question, input.patientId);

    // Step 3: Build the prompt with retrieved context
    const prompt = buildRAGPrompt(input.question, patientContext, relevantDocs, input.additionalContext);

    // Step 4: Generate response using LLM
    const response = await generateResponse(prompt);

    // Step 5: Extract confidence and format output
    const sources = relevantDocs.map((doc) => ({
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
      excerpt: doc.content.substring(0, 200),
      relevance: doc.similarity,
    }));

    return {
      success: true,
      question: input.question,
      answer: response.text,
      sources: sources,
      confidence: response.confidence,
      model: LLM_MODEL,
      tokensUsed: response.tokensUsed,
    };
  } catch (error) {
    console.error('RAG pipeline error:', error);
    return {
      success: false,
      question: input.question,
      answer: `Error processing question: ${error}`,
      sources: [],
      confidence: 0,
      model: LLM_MODEL,
    };
  }
}

/**
 * Gather structured patient context
 */
async function gatherPatientContext(medplum: MedplumClient, patientId: string): Promise<string> {
  const contextParts: string[] = [];

  try {
    // Get patient demographics
    const patient = await medplum.readResource('Patient', patientId);
    contextParts.push(formatPatientDemographics(patient));

    // Get active conditions
    const conditions = await medplum.searchResources('Condition', {
      patient: `Patient/${patientId}`,
      'clinical-status': 'active',
      _count: '20',
    });
    if (conditions.length > 0) {
      contextParts.push(formatConditions(conditions));
    }

    // Get recent medications
    const medications = await medplum.searchResources('MedicationStatement', {
      patient: `Patient/${patientId}`,
      status: 'active',
      _count: '20',
    });
    if (medications.length > 0) {
      contextParts.push(formatMedications(medications));
    }

    // Get recent vital signs
    const vitals = await medplum.searchResources('Observation', {
      patient: `Patient/${patientId}`,
      category: 'vital-signs',
      _sort: '-date',
      _count: '10',
    });
    if (vitals.length > 0) {
      contextParts.push(formatVitals(vitals));
    }

    // Get recent lab results
    const labs = await medplum.searchResources('Observation', {
      patient: `Patient/${patientId}`,
      category: 'laboratory',
      _sort: '-date',
      _count: '10',
    });
    if (labs.length > 0) {
      contextParts.push(formatLabs(labs));
    }
  } catch (error) {
    console.error('Error gathering patient context:', error);
  }

  return contextParts.join('\n\n');
}

/**
 * Format patient demographics
 */
function formatPatientDemographics(patient: Patient): string {
  const name = patient.name?.[0];
  const fullName = name ? `${name.given?.join(' ')} ${name.family}` : 'Unknown';
  const birthDate = patient.birthDate || 'Unknown';
  const gender = patient.gender || 'Unknown';

  return `PATIENT INFORMATION:
Name: ${fullName}
Date of Birth: ${birthDate}
Gender: ${gender}`;
}

/**
 * Format conditions list
 */
function formatConditions(conditions: Condition[]): string {
  const conditionList = conditions
    .map((c) => {
      const name = c.code?.text || c.code?.coding?.[0]?.display || 'Unknown';
      const status = c.clinicalStatus?.coding?.[0]?.code || 'unknown';
      const onset = c.onsetDateTime || c.onsetString || '';
      return `- ${name} (${status})${onset ? ` since ${onset}` : ''}`;
    })
    .join('\n');

  return `ACTIVE CONDITIONS:\n${conditionList}`;
}

/**
 * Format medications list
 */
function formatMedications(medications: MedicationStatement[]): string {
  const medList = medications
    .map((m) => {
      const name = m.medicationCodeableConcept?.text ||
        m.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown';
      const dosage = m.dosage?.[0]?.text || '';
      return `- ${name}${dosage ? `: ${dosage}` : ''}`;
    })
    .join('\n');

  return `CURRENT MEDICATIONS:\n${medList}`;
}

/**
 * Format vital signs
 */
function formatVitals(vitals: Observation[]): string {
  const vitalList = vitals
    .map((v) => {
      const name = v.code?.text || v.code?.coding?.[0]?.display || 'Unknown';
      let value = '';
      if (v.valueQuantity) {
        value = `${v.valueQuantity.value} ${v.valueQuantity.unit || ''}`;
      } else if (v.valueString) {
        value = v.valueString;
      }
      const date = v.effectiveDateTime?.substring(0, 10) || '';
      return `- ${name}: ${value}${date ? ` (${date})` : ''}`;
    })
    .join('\n');

  return `RECENT VITAL SIGNS:\n${vitalList}`;
}

/**
 * Format lab results
 */
function formatLabs(labs: Observation[]): string {
  const labList = labs
    .map((l) => {
      const name = l.code?.text || l.code?.coding?.[0]?.display || 'Unknown';
      let value = '';
      if (l.valueQuantity) {
        value = `${l.valueQuantity.value} ${l.valueQuantity.unit || ''}`;
      } else if (l.valueString) {
        value = l.valueString;
      }
      const interpretation = l.interpretation?.[0]?.coding?.[0]?.code || '';
      const date = l.effectiveDateTime?.substring(0, 10) || '';
      return `- ${name}: ${value}${interpretation ? ` [${interpretation}]` : ''}${date ? ` (${date})` : ''}`;
    })
    .join('\n');

  return `RECENT LAB RESULTS:\n${labList}`;
}

/**
 * Semantic search for relevant documents
 */
async function semanticSearch(
  medplum: MedplumClient,
  query: string,
  patientId: string
): Promise<Array<{ resourceType: string; resourceId: string; content: string; similarity: number }>> {
  try {
    // Generate query embedding
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: query }),
    });

    if (!response.ok) {
      console.error('Embedding error');
      return [];
    }

    const { embedding } = await response.json() as { embedding: number[] };

    // Search Binary resources for embeddings (workaround)
    // In production, use direct PostgreSQL pgvector query
    const binaries = await medplum.searchResources('Binary', {
      _count: '500',
      'content-type': 'application/json',
    });

    const results: Array<{ resourceType: string; resourceId: string; content: string; similarity: number }> = [];

    for (const binary of binaries) {
      try {
        if (!binary.data) continue;
        const data = JSON.parse(Buffer.from(binary.data, 'base64').toString('utf-8'));

        if (data.type !== 'clinical_embedding') continue;
        if (data.patient_id !== patientId) continue;

        const similarity = cosineSimilarity(embedding, data.embedding);
        if (similarity > 0.6) {
          results.push({
            resourceType: data.fhir_resource_type,
            resourceId: data.fhir_resource_id,
            content: data.content_text,
            similarity,
          });
        }
      } catch {
        continue;
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, TOP_K_RESULTS);
  } catch (error) {
    console.error('Semantic search error:', error);
    return [];
  }
}

/**
 * Cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build RAG prompt
 */
function buildRAGPrompt(
  question: string,
  patientContext: string,
  relevantDocs: Array<{ content: string }>,
  additionalContext?: string
): string {
  let context = patientContext;

  if (relevantDocs.length > 0) {
    const docsText = relevantDocs.map((d, i) => `Document ${i + 1}:\n${d.content}`).join('\n\n');
    context += `\n\nRELEVANT CLINICAL DOCUMENTS:\n${docsText}`;
  }

  if (additionalContext) {
    context += `\n\nADDITIONAL CONTEXT:\n${additionalContext}`;
  }

  // Truncate if too long
  if (context.length > MAX_CONTEXT_LENGTH) {
    context = context.substring(0, MAX_CONTEXT_LENGTH) + '...[truncated]';
  }

  return `You are a clinical decision support AI assistant. Answer the following question about a patient based ONLY on the provided clinical context. If the information is not available in the context, say so. Do not make assumptions or provide information not supported by the context.

Be concise and clinically relevant. If suggesting any clinical actions, note that they require physician review.

CLINICAL CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;
}

/**
 * Generate response using Ollama
 */
async function generateResponse(prompt: string): Promise<{ text: string; confidence: number; tokensUsed?: number }> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 500,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const result = await response.json() as { response: string; eval_count?: number };

    // Estimate confidence based on response characteristics
    const confidence = estimateConfidence(result.response);

    return {
      text: result.response,
      confidence,
      tokensUsed: result.eval_count,
    };
  } catch (error) {
    console.error('LLM generation error:', error);
    return {
      text: 'Unable to generate response due to an error.',
      confidence: 0,
    };
  }
}

/**
 * Estimate confidence based on response characteristics
 */
function estimateConfidence(response: string): number {
  let confidence = 0.7; // Base confidence

  // Lower confidence for uncertain language
  const uncertainPhrases = ['not sure', 'unclear', 'cannot determine', 'insufficient', 'may be', 'possibly'];
  for (const phrase of uncertainPhrases) {
    if (response.toLowerCase().includes(phrase)) {
      confidence -= 0.1;
    }
  }

  // Higher confidence for specific clinical references
  const clinicalTerms = ['diagnosis', 'medication', 'lab result', 'vital sign', 'condition'];
  for (const term of clinicalTerms) {
    if (response.toLowerCase().includes(term)) {
      confidence += 0.05;
    }
  }

  return Math.max(0.1, Math.min(0.95, confidence));
}

export default handler;
