/**
 * Billing Code Suggester Bot
 *
 * AI-powered medical billing code suggestions.
 * Analyzes encounter documentation to suggest appropriate CPT, ICD-10, and HCPCS codes.
 *
 * Input: { encounterId: string, patientId: string }
 * Output: { success: boolean, suggestedCodes: BillingCode[], commands: AICommand[] }
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import {
  Encounter,
  Condition,
  Procedure,
  Observation,
  DocumentReference,
  DiagnosticReport,
  MedicationRequest,
} from '@medplum/fhirtypes';
import { AICommand, SuggestBillingCodesCommand } from './types/ai-command-types';

// Default configuration - vmcontext doesn't have process.env
const OLLAMA_URL = (typeof process !== 'undefined' && process.env?.OLLAMA_API_BASE) ||
                   (typeof process !== 'undefined' && process.env?.OLLAMA_URL) ||
                   'http://host.docker.internal:11434';
const LLM_MODEL = (typeof process !== 'undefined' && process.env?.LLM_MODEL) || 'qwen3:4b';

interface BillingInput {
  encounterId: string;
  patientId: string;
  includeModifiers?: boolean;
}

interface BillingCode {
  code: string;
  system: 'CPT' | 'ICD-10-CM' | 'ICD-10-PCS' | 'HCPCS';
  display: string;
  category: 'diagnosis' | 'procedure' | 'supply' | 'evaluation';
  confidence: number;
  reasoning: string;
  modifiers?: string[];
  linkedDiagnosis?: string; // For CPT codes, link to supporting ICD-10
}

interface BillingOutput {
  success: boolean;
  encounterId: string;
  suggestedCodes: BillingCode[];
  totalConfidence: number;
  warnings: string[];
  commands: AICommand[];
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<BillingOutput> {
  const input = event.input as BillingInput;

  if (!input?.encounterId || !input?.patientId) {
    return {
      success: false,
      encounterId: input?.encounterId || '',
      suggestedCodes: [],
      totalConfidence: 0,
      warnings: ['Error: encounterId and patientId are required'],
      commands: [],
    };
  }

  console.log(`Billing code suggestion for encounter ${input.encounterId}`);

  try {
    // Gather encounter context
    const context = await gatherBillingContext(medplum, input);

    // Extract codes from structured data
    const structuredCodes = extractStructuredCodes(context);

    // Use LLM to suggest additional codes and validate
    const llmCodes = await suggestCodesWithLLM(context, structuredCodes);

    // Merge and deduplicate
    const allCodes = mergeAndRankCodes(structuredCodes, llmCodes);

    // Validate code relationships
    const validatedCodes = validateCodeRelationships(allCodes);

    // Calculate total confidence
    const totalConfidence =
      validatedCodes.length > 0
        ? validatedCodes.reduce((sum, c) => sum + c.confidence, 0) / validatedCodes.length
        : 0;

    // Create command for approval
    const commands: AICommand[] = [];
    if (validatedCodes.length > 0) {
      const billingCommand: SuggestBillingCodesCommand = {
        command: 'SuggestBillingCodes',
        patientId: input.patientId,
        encounterId: input.encounterId,
        suggestedCodes: validatedCodes.map((c) => ({
          code: c.code,
          system: c.system,
          display: c.display,
          confidence: c.confidence,
        })),
        confidence: totalConfidence,
        requiresApproval: true,
        aiModel: LLM_MODEL,
        reasoning: `Suggested ${validatedCodes.length} billing codes based on encounter documentation`,
      };
      commands.push(billingCommand);
    }

    // Generate warnings
    const warnings = generateBillingWarnings(validatedCodes, context);

    return {
      success: true,
      encounterId: input.encounterId,
      suggestedCodes: validatedCodes,
      totalConfidence,
      warnings,
      commands,
    };
  } catch (error) {
    console.log('Billing code suggester error:', error);
    return {
      success: false,
      encounterId: input.encounterId,
      suggestedCodes: [],
      totalConfidence: 0,
      warnings: [`Error suggesting codes: ${error}`],
      commands: [],
    };
  }
}

interface BillingContext {
  encounter: Encounter | null;
  conditions: Condition[];
  procedures: Procedure[];
  observations: Observation[];
  diagnosticReports: DiagnosticReport[];
  medications: MedicationRequest[];
  documents: DocumentReference[];
}

/**
 * Gather context for billing
 */
async function gatherBillingContext(medplum: MedplumClient, input: BillingInput): Promise<BillingContext> {
  const context: BillingContext = {
    encounter: null,
    conditions: [],
    procedures: [],
    observations: [],
    diagnosticReports: [],
    medications: [],
    documents: [],
  };

  try {
    // Get encounter
    context.encounter = await medplum.readResource('Encounter', input.encounterId);

    // Get conditions for this encounter or patient
    context.conditions = await medplum.searchResources('Condition', {
      patient: `Patient/${input.patientId}`,
      encounter: `Encounter/${input.encounterId}`,
      _count: '50',
    });

    // Also get active conditions not linked to encounter
    const activeConditions = await medplum.searchResources('Condition', {
      patient: `Patient/${input.patientId}`,
      'clinical-status': 'active',
      _count: '30',
    });
    context.conditions = [...context.conditions, ...activeConditions];

    // Get procedures
    context.procedures = await medplum.searchResources('Procedure', {
      patient: `Patient/${input.patientId}`,
      encounter: `Encounter/${input.encounterId}`,
      _count: '30',
    });

    // Get observations
    context.observations = await medplum.searchResources('Observation', {
      patient: `Patient/${input.patientId}`,
      encounter: `Encounter/${input.encounterId}`,
      _count: '50',
    });

    // Get diagnostic reports
    context.diagnosticReports = await medplum.searchResources('DiagnosticReport', {
      patient: `Patient/${input.patientId}`,
      encounter: `Encounter/${input.encounterId}`,
      _count: '20',
    });

    // Get medications
    context.medications = await medplum.searchResources('MedicationRequest', {
      patient: `Patient/${input.patientId}`,
      encounter: `Encounter/${input.encounterId}`,
      _count: '20',
    });

    // Get clinical documents
    context.documents = await medplum.searchResources('DocumentReference', {
      patient: `Patient/${input.patientId}`,
      'context.encounter': `Encounter/${input.encounterId}`,
      _count: '10',
    });
  } catch (error) {
    console.log('Error gathering billing context:', error);
  }

  return context;
}

/**
 * Extract codes from structured FHIR data
 */
function extractStructuredCodes(context: BillingContext): BillingCode[] {
  const codes: BillingCode[] = [];

  // Extract ICD-10 codes from conditions
  for (const condition of context.conditions) {
    const coding = condition.code?.coding?.find(
      (c) => c.system?.includes('icd-10') || c.system?.includes('icd10')
    );
    if (coding?.code) {
      codes.push({
        code: coding.code,
        system: 'ICD-10-CM',
        display: coding.display || condition.code?.text || 'Unknown',
        category: 'diagnosis',
        confidence: 0.9, // High confidence for structured data
        reasoning: `Extracted from Condition/${condition.id}`,
      });
    }
  }

  // Extract CPT/procedure codes
  for (const procedure of context.procedures) {
    const cptCoding = procedure.code?.coding?.find(
      (c) => c.system?.includes('cpt') || c.system?.includes('ama-assn')
    );
    if (cptCoding?.code) {
      codes.push({
        code: cptCoding.code,
        system: 'CPT',
        display: cptCoding.display || procedure.code?.text || 'Unknown',
        category: 'procedure',
        confidence: 0.9,
        reasoning: `Extracted from Procedure/${procedure.id}`,
      });
    }

    // Also check for ICD-10-PCS
    const pcsCoding = procedure.code?.coding?.find((c) => c.system?.includes('icd-10-pcs'));
    if (pcsCoding?.code) {
      codes.push({
        code: pcsCoding.code,
        system: 'ICD-10-PCS',
        display: pcsCoding.display || 'Unknown',
        category: 'procedure',
        confidence: 0.9,
        reasoning: `Extracted from Procedure/${procedure.id}`,
      });
    }
  }

  return codes;
}

/**
 * Use LLM to suggest additional codes
 */
async function suggestCodesWithLLM(
  context: BillingContext,
  existingCodes: BillingCode[]
): Promise<BillingCode[]> {
  const prompt = buildBillingPrompt(context, existingCodes);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2, // Low temperature for accuracy
          top_p: 0.9,
          num_predict: 1500,
        },
      }),
    });

    if (!response.ok) {
      console.log('LLM API error:', response.status);
      return [];
    }

    const result = await response.json() as { response: string };
    return parseLLMCodes(result.response);
  } catch (error) {
    console.log('LLM code suggestion error:', error);
    return [];
  }
}

/**
 * Build prompt for billing code suggestion
 */
function buildBillingPrompt(context: BillingContext, existingCodes: BillingCode[]): string {
  const encounter = context.encounter;
  const encounterType = encounter?.type?.[0]?.text || encounter?.class?.display || 'Office Visit';

  const conditionsList = context.conditions
    .map((c) => `- ${c.code?.text || c.code?.coding?.[0]?.display || 'Unknown'}`)
    .join('\n');

  const proceduresList = context.procedures
    .map((p) => `- ${p.code?.text || p.code?.coding?.[0]?.display || 'Unknown'}`)
    .join('\n');

  const observationsList = context.observations
    .slice(0, 15)
    .map((o) => {
      const name = o.code?.text || o.code?.coding?.[0]?.display || 'Unknown';
      const value = o.valueQuantity
        ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ''}`
        : o.valueString || '';
      return `- ${name}: ${value}`;
    })
    .join('\n');

  const existingCodesList = existingCodes.map((c) => `- ${c.system}: ${c.code} (${c.display})`).join('\n');

  return `You are a medical billing coding assistant. Analyze the following encounter documentation and suggest appropriate billing codes.

ENCOUNTER TYPE: ${encounterType}
ENCOUNTER DATE: ${encounter?.period?.start || 'Unknown'}

DOCUMENTED CONDITIONS:
${conditionsList || 'None documented'}

PROCEDURES PERFORMED:
${proceduresList || 'None documented'}

CLINICAL OBSERVATIONS:
${observationsList || 'None documented'}

ALREADY IDENTIFIED CODES:
${existingCodesList || 'None'}

Based on this encounter, suggest additional billing codes that should be considered. For each code, provide:
1. The code (CPT, ICD-10-CM, or HCPCS)
2. The code system
3. The description
4. Your confidence (0.0-1.0)
5. Brief reasoning

Consider:
- E&M (Evaluation and Management) codes based on encounter complexity
- Any procedures that may not be captured
- Supporting diagnosis codes
- HCPCS codes for supplies or services

Format your response as:
CODE: [code]
SYSTEM: [CPT/ICD-10-CM/HCPCS]
DESCRIPTION: [description]
CONFIDENCE: [0.0-1.0]
REASONING: [brief reasoning]
---

Suggest ONLY codes supported by the documentation. Do not suggest codes for services not documented.

SUGGESTED CODES:`;
}

/**
 * Parse LLM response for codes
 */
function parseLLMCodes(response: string): BillingCode[] {
  const codes: BillingCode[] = [];
  const entries = response.split('---');

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const code: Partial<BillingCode> = {};

    for (const line of lines) {
      if (line.startsWith('CODE:')) {
        code.code = line.replace('CODE:', '').trim();
      } else if (line.startsWith('SYSTEM:')) {
        const system = line.replace('SYSTEM:', '').trim().toUpperCase();
        if (system === 'CPT' || system === 'ICD-10-CM' || system === 'ICD-10-PCS' || system === 'HCPCS') {
          code.system = system;
        }
      } else if (line.startsWith('DESCRIPTION:')) {
        code.display = line.replace('DESCRIPTION:', '').trim();
      } else if (line.startsWith('CONFIDENCE:')) {
        const conf = parseFloat(line.replace('CONFIDENCE:', '').trim());
        code.confidence = isNaN(conf) ? 0.5 : Math.min(1, Math.max(0, conf));
      } else if (line.startsWith('REASONING:')) {
        code.reasoning = line.replace('REASONING:', '').trim();
      }
    }

    // Validate and add code
    if (code.code && code.system && code.display) {
      // Determine category based on system
      if (code.system === 'ICD-10-CM') {
        code.category = 'diagnosis';
      } else if (code.system === 'CPT' || code.system === 'ICD-10-PCS') {
        code.category = 'procedure';
      } else if (code.system === 'HCPCS') {
        code.category = 'supply';
      }

      // Cap LLM confidence lower than structured data
      code.confidence = Math.min(code.confidence || 0.5, 0.8);
      code.reasoning = code.reasoning || 'AI-suggested based on encounter documentation';

      codes.push(code as BillingCode);
    }
  }

  return codes;
}

/**
 * Merge and rank codes from different sources
 */
function mergeAndRankCodes(structuredCodes: BillingCode[], llmCodes: BillingCode[]): BillingCode[] {
  const codeMap = new Map<string, BillingCode>();

  // Add structured codes first (higher confidence)
  for (const code of structuredCodes) {
    const key = `${code.system}:${code.code}`;
    codeMap.set(key, code);
  }

  // Add LLM codes if not duplicates
  for (const code of llmCodes) {
    const key = `${code.system}:${code.code}`;
    if (!codeMap.has(key)) {
      codeMap.set(key, code);
    }
  }

  // Convert to array and sort by confidence
  const allCodes = Array.from(codeMap.values());
  allCodes.sort((a, b) => b.confidence - a.confidence);

  return allCodes;
}

/**
 * Validate relationships between codes
 */
function validateCodeRelationships(codes: BillingCode[]): BillingCode[] {
  // Get diagnosis codes
  const diagnosisCodes = codes.filter((c) => c.category === 'diagnosis');
  const procedureCodes = codes.filter((c) => c.category === 'procedure');

  // Link procedure codes to diagnosis codes
  for (const proc of procedureCodes) {
    if (diagnosisCodes.length > 0 && !proc.linkedDiagnosis) {
      // Link to first relevant diagnosis
      proc.linkedDiagnosis = diagnosisCodes[0].code;
    }
  }

  // Check for E&M code presence
  const hasEMCode = procedureCodes.some((c) => c.code.startsWith('99'));

  // If no E&M code for office visit, flag it
  // (This would be handled in warnings)

  return codes;
}

/**
 * Generate billing warnings
 */
function generateBillingWarnings(codes: BillingCode[], context: BillingContext): string[] {
  const warnings: string[] = [];

  // Check for missing E&M code
  const hasEMCode = codes.some((c) => c.system === 'CPT' && c.code.startsWith('99'));
  if (!hasEMCode && context.encounter) {
    warnings.push('No E&M (Evaluation and Management) code suggested - verify encounter complexity');
  }

  // Check for procedures without supporting diagnosis
  const diagnosisCodes = codes.filter((c) => c.category === 'diagnosis');
  const procedureCodes = codes.filter((c) => c.category === 'procedure');

  if (procedureCodes.length > 0 && diagnosisCodes.length === 0) {
    warnings.push('Procedure codes suggested without supporting diagnosis codes');
  }

  // Check for low confidence codes
  const lowConfidenceCodes = codes.filter((c) => c.confidence < 0.6);
  if (lowConfidenceCodes.length > 0) {
    warnings.push(`${lowConfidenceCodes.length} code(s) have low confidence and need review`);
  }

  // Check for common bundling issues
  const cptCodes = codes.filter((c) => c.system === 'CPT').map((c) => c.code);
  if (cptCodes.includes('99213') && cptCodes.includes('99214')) {
    warnings.push('Multiple E&M codes suggested - only one should be billed per visit');
  }

  return warnings;
}

export default handler;
