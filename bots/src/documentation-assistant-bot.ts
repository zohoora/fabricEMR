/**
 * Documentation Assistant Bot
 *
 * AI-powered clinical documentation assistance.
 * Helps generate encounter notes, discharge summaries, and referral letters.
 *
 * Input: { patientId: string, encounterId?: string, documentType: string, instructions?: string }
 * Output: { success: boolean, draft: string, commands: AICommand[] }
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import {
  Patient,
  Encounter,
  Condition,
  Observation,
  MedicationRequest,
  Procedure,
  DiagnosticReport,
  AllergyIntolerance,
} from '@medplum/fhirtypes';
import { AICommand } from './types/ai-command-types';

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';

type DocumentType =
  | 'progress_note'
  | 'discharge_summary'
  | 'consultation_note'
  | 'referral_letter'
  | 'procedure_note'
  | 'h_and_p';

interface DocumentationInput {
  patientId: string;
  encounterId?: string;
  documentType: DocumentType;
  instructions?: string;
  recipientName?: string;
  recipientSpecialty?: string;
}

interface DocumentationOutput {
  success: boolean;
  documentType: DocumentType;
  draft: string;
  sections: Record<string, string>;
  commands: AICommand[];
  confidence: number;
  warnings: string[];
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<DocumentationOutput> {
  const input = event.input as DocumentationInput;

  if (!input?.patientId || !input?.documentType) {
    return {
      success: false,
      documentType: input?.documentType || 'progress_note',
      draft: '',
      sections: {},
      commands: [],
      confidence: 0,
      warnings: ['Error: patientId and documentType are required'],
    };
  }

  console.log(`Documentation assistant: ${input.documentType} for patient ${input.patientId}`);

  try {
    // Gather comprehensive patient context
    const context = await gatherDocumentationContext(medplum, input);

    // Generate the appropriate document
    const result = await generateDocument(input, context);

    // Create command to save as draft
    const commands: AICommand[] = [];
    if (result.draft && input.encounterId) {
      commands.push({
        command: 'CreateEncounterNoteDraft',
        patientId: input.patientId,
        encounterId: input.encounterId,
        noteType: mapDocumentTypeToNoteType(input.documentType),
        content: result.draft,
        confidence: result.confidence,
        requiresApproval: true,
        aiModel: LLM_MODEL,
        reasoning: `AI-generated ${input.documentType} based on patient data`,
      });
    }

    return {
      success: true,
      documentType: input.documentType,
      draft: result.draft,
      sections: result.sections,
      commands,
      confidence: result.confidence,
      warnings: result.warnings,
    };
  } catch (error) {
    console.error('Documentation assistant error:', error);
    return {
      success: false,
      documentType: input.documentType,
      draft: '',
      sections: {},
      commands: [],
      confidence: 0,
      warnings: [`Error generating document: ${error}`],
    };
  }
}

/**
 * Map document type to note type for command
 */
function mapDocumentTypeToNoteType(docType: DocumentType): 'progress' | 'discharge' | 'consultation' {
  switch (docType) {
    case 'discharge_summary':
      return 'discharge';
    case 'consultation_note':
    case 'referral_letter':
      return 'consultation';
    default:
      return 'progress';
  }
}

/**
 * Gather comprehensive context for documentation
 */
async function gatherDocumentationContext(
  medplum: MedplumClient,
  input: DocumentationInput
): Promise<DocumentationContext> {
  const context: DocumentationContext = {
    patient: null,
    encounter: null,
    conditions: [],
    medications: [],
    allergies: [],
    vitals: [],
    labs: [],
    procedures: [],
    diagnosticReports: [],
  };

  try {
    // Get patient
    context.patient = await medplum.readResource('Patient', input.patientId);

    // Get encounter if specified
    if (input.encounterId) {
      context.encounter = await medplum.readResource('Encounter', input.encounterId);
    }

    // Get active conditions
    context.conditions = await medplum.searchResources('Condition', {
      patient: `Patient/${input.patientId}`,
      _count: '50',
    });

    // Get medications
    context.medications = await medplum.searchResources('MedicationRequest', {
      patient: `Patient/${input.patientId}`,
      status: 'active',
      _count: '30',
    });

    // Get allergies
    context.allergies = await medplum.searchResources('AllergyIntolerance', {
      patient: `Patient/${input.patientId}`,
      _count: '20',
    });

    // Get recent vitals
    context.vitals = await medplum.searchResources('Observation', {
      patient: `Patient/${input.patientId}`,
      category: 'vital-signs',
      _sort: '-date',
      _count: '20',
    });

    // Get recent labs
    context.labs = await medplum.searchResources('Observation', {
      patient: `Patient/${input.patientId}`,
      category: 'laboratory',
      _sort: '-date',
      _count: '30',
    });

    // Get procedures
    context.procedures = await medplum.searchResources('Procedure', {
      patient: `Patient/${input.patientId}`,
      _sort: '-date',
      _count: '20',
    });

    // Get diagnostic reports
    context.diagnosticReports = await medplum.searchResources('DiagnosticReport', {
      patient: `Patient/${input.patientId}`,
      _sort: '-date',
      _count: '10',
    });
  } catch (error) {
    console.error('Error gathering documentation context:', error);
  }

  return context;
}

interface DocumentationContext {
  patient: Patient | null;
  encounter: Encounter | null;
  conditions: Condition[];
  medications: MedicationRequest[];
  allergies: AllergyIntolerance[];
  vitals: Observation[];
  labs: Observation[];
  procedures: Procedure[];
  diagnosticReports: DiagnosticReport[];
}

/**
 * Generate the document based on type
 */
async function generateDocument(
  input: DocumentationInput,
  context: DocumentationContext
): Promise<{ draft: string; sections: Record<string, string>; confidence: number; warnings: string[] }> {
  const warnings: string[] = [];

  // Check for missing data
  if (!context.patient) {
    warnings.push('Patient data not found');
  }
  if (context.conditions.length === 0) {
    warnings.push('No conditions on file');
  }
  if (context.medications.length === 0) {
    warnings.push('No medications on file');
  }

  // Build the prompt based on document type
  let prompt: string;
  let sections: Record<string, string> = {};

  switch (input.documentType) {
    case 'progress_note':
      prompt = buildProgressNotePrompt(context, input.instructions);
      break;
    case 'discharge_summary':
      prompt = buildDischargeSummaryPrompt(context, input.instructions);
      break;
    case 'consultation_note':
      prompt = buildConsultationNotePrompt(context, input.instructions);
      break;
    case 'referral_letter':
      prompt = buildReferralLetterPrompt(context, input);
      break;
    case 'procedure_note':
      prompt = buildProcedureNotePrompt(context, input.instructions);
      break;
    case 'h_and_p':
      prompt = buildHAndPPrompt(context, input.instructions);
      break;
    default:
      prompt = buildProgressNotePrompt(context, input.instructions);
  }

  // Generate using LLM
  const response = await callLLM(prompt);

  // Parse sections from the response
  sections = parseSections(response.text, input.documentType);

  return {
    draft: response.text,
    sections,
    confidence: response.confidence,
    warnings,
  };
}

/**
 * Build progress note prompt
 */
function buildProgressNotePrompt(context: DocumentationContext, instructions?: string): string {
  const patientInfo = formatPatientInfo(context.patient);
  const conditions = formatConditionsList(context.conditions);
  const medications = formatMedicationsList(context.medications);
  const vitals = formatVitalsList(context.vitals);
  const labs = formatLabsList(context.labs);

  return `You are a medical documentation assistant. Generate a clinical progress note based on the following patient information.

PATIENT INFORMATION:
${patientInfo}

ACTIVE CONDITIONS:
${conditions}

CURRENT MEDICATIONS:
${medications}

RECENT VITAL SIGNS:
${vitals}

RECENT LAB RESULTS:
${labs}

${instructions ? `ADDITIONAL INSTRUCTIONS: ${instructions}` : ''}

Generate a SOAP-format progress note with the following sections:
- SUBJECTIVE: Patient's chief complaint and history (use placeholders like [PATIENT REPORTS...] for subjective data)
- OBJECTIVE: Vital signs, physical exam findings, lab results
- ASSESSMENT: Clinical assessment of each active problem
- PLAN: Treatment plan for each problem

Use professional medical terminology. Mark any sections requiring clinician input with [CLINICIAN TO COMPLETE].

PROGRESS NOTE:`;
}

/**
 * Build discharge summary prompt
 */
function buildDischargeSummaryPrompt(context: DocumentationContext, instructions?: string): string {
  const patientInfo = formatPatientInfo(context.patient);
  const encounter = context.encounter;
  const conditions = formatConditionsList(context.conditions);
  const medications = formatMedicationsList(context.medications);
  const procedures = formatProceduresList(context.procedures);

  return `You are a medical documentation assistant. Generate a discharge summary based on the following information.

PATIENT INFORMATION:
${patientInfo}

ADMISSION INFORMATION:
${encounter ? `Admission Date: ${encounter.period?.start || '[DATE]'}
Discharge Date: ${encounter.period?.end || '[DATE]'}
Reason for Admission: ${encounter.reasonCode?.[0]?.text || '[REASON]'}` : '[ENCOUNTER DETAILS NOT AVAILABLE]'}

DIAGNOSES:
${conditions}

PROCEDURES PERFORMED:
${procedures}

DISCHARGE MEDICATIONS:
${medications}

${instructions ? `ADDITIONAL INSTRUCTIONS: ${instructions}` : ''}

Generate a comprehensive discharge summary with:
1. ADMISSION DIAGNOSIS
2. DISCHARGE DIAGNOSIS
3. HOSPITAL COURSE
4. PROCEDURES PERFORMED
5. DISCHARGE MEDICATIONS (with instructions)
6. FOLLOW-UP APPOINTMENTS
7. DISCHARGE INSTRUCTIONS
8. WARNING SIGNS TO WATCH FOR

Mark any sections requiring clinician input with [CLINICIAN TO COMPLETE].

DISCHARGE SUMMARY:`;
}

/**
 * Build consultation note prompt
 */
function buildConsultationNotePrompt(context: DocumentationContext, instructions?: string): string {
  const patientInfo = formatPatientInfo(context.patient);
  const conditions = formatConditionsList(context.conditions);
  const medications = formatMedicationsList(context.medications);
  const labs = formatLabsList(context.labs);

  return `You are a medical documentation assistant. Generate a consultation note.

PATIENT INFORMATION:
${patientInfo}

CURRENT CONDITIONS:
${conditions}

CURRENT MEDICATIONS:
${medications}

RELEVANT LABORATORY DATA:
${labs}

${instructions ? `REASON FOR CONSULTATION: ${instructions}` : 'REASON FOR CONSULTATION: [SPECIFY REASON]'}

Generate a consultation note with:
1. REASON FOR CONSULTATION
2. HISTORY OF PRESENT ILLNESS
3. PAST MEDICAL HISTORY
4. CURRENT MEDICATIONS
5. ALLERGIES
6. PHYSICAL EXAMINATION
7. LABORATORY/IMAGING REVIEW
8. ASSESSMENT
9. RECOMMENDATIONS

Mark sections requiring clinician input with [CLINICIAN TO COMPLETE].

CONSULTATION NOTE:`;
}

/**
 * Build referral letter prompt
 */
function buildReferralLetterPrompt(context: DocumentationContext, input: DocumentationInput): string {
  const patientInfo = formatPatientInfo(context.patient);
  const conditions = formatConditionsList(context.conditions);
  const medications = formatMedicationsList(context.medications);

  return `You are a medical documentation assistant. Generate a referral letter.

PATIENT INFORMATION:
${patientInfo}

CURRENT CONDITIONS:
${conditions}

CURRENT MEDICATIONS:
${medications}

REFERRAL TO: ${input.recipientName || '[SPECIALIST NAME]'}
SPECIALTY: ${input.recipientSpecialty || '[SPECIALTY]'}
${input.instructions ? `REASON FOR REFERRAL: ${input.instructions}` : 'REASON FOR REFERRAL: [SPECIFY REASON]'}

Generate a professional referral letter including:
1. Patient identification and demographics
2. Reason for referral
3. Relevant medical history
4. Current medications
5. Recent relevant test results
6. Specific questions for the consultant
7. Urgency level

Mark sections requiring clinician input with [CLINICIAN TO COMPLETE].

REFERRAL LETTER:`;
}

/**
 * Build procedure note prompt
 */
function buildProcedureNotePrompt(context: DocumentationContext, instructions?: string): string {
  const patientInfo = formatPatientInfo(context.patient);
  const procedures = formatProceduresList(context.procedures);

  return `You are a medical documentation assistant. Generate a procedure note template.

PATIENT INFORMATION:
${patientInfo}

RECENT PROCEDURES:
${procedures}

${instructions ? `PROCEDURE TO DOCUMENT: ${instructions}` : 'PROCEDURE: [SPECIFY PROCEDURE]'}

Generate a procedure note with:
1. PROCEDURE NAME AND DATE
2. INDICATION
3. INFORMED CONSENT
4. ANESTHESIA/SEDATION
5. PROCEDURE DESCRIPTION
6. FINDINGS
7. SPECIMENS (if applicable)
8. COMPLICATIONS
9. ESTIMATED BLOOD LOSS
10. POST-PROCEDURE CONDITION
11. POST-PROCEDURE INSTRUCTIONS

Mark all sections requiring clinician input with [CLINICIAN TO COMPLETE].

PROCEDURE NOTE:`;
}

/**
 * Build H&P prompt
 */
function buildHAndPPrompt(context: DocumentationContext, instructions?: string): string {
  const patientInfo = formatPatientInfo(context.patient);
  const conditions = formatConditionsList(context.conditions);
  const medications = formatMedicationsList(context.medications);
  const allergies = formatAllergiesList(context.allergies);
  const vitals = formatVitalsList(context.vitals);

  return `You are a medical documentation assistant. Generate a History and Physical (H&P) document.

PATIENT INFORMATION:
${patientInfo}

KNOWN CONDITIONS:
${conditions}

CURRENT MEDICATIONS:
${medications}

ALLERGIES:
${allergies}

RECENT VITAL SIGNS:
${vitals}

${instructions ? `CHIEF COMPLAINT: ${instructions}` : 'CHIEF COMPLAINT: [SPECIFY]'}

Generate a comprehensive H&P with:
1. CHIEF COMPLAINT
2. HISTORY OF PRESENT ILLNESS
3. PAST MEDICAL HISTORY
4. PAST SURGICAL HISTORY
5. FAMILY HISTORY
6. SOCIAL HISTORY
7. CURRENT MEDICATIONS
8. ALLERGIES
9. REVIEW OF SYSTEMS
10. PHYSICAL EXAMINATION
11. LABORATORY/IMAGING DATA
12. ASSESSMENT
13. PLAN

Mark sections requiring clinician input with [CLINICIAN TO COMPLETE].

HISTORY AND PHYSICAL:`;
}

/**
 * Format patient info
 */
function formatPatientInfo(patient: Patient | null): string {
  if (!patient) return 'Patient information not available';

  const name = patient.name?.[0];
  const fullName = name ? `${name.given?.join(' ')} ${name.family}` : 'Unknown';

  return `Name: ${fullName}
DOB: ${patient.birthDate || 'Unknown'}
Gender: ${patient.gender || 'Unknown'}
MRN: ${patient.identifier?.find((i) => i.type?.text === 'MRN')?.value || patient.id || 'Unknown'}`;
}

/**
 * Format conditions list
 */
function formatConditionsList(conditions: Condition[]): string {
  if (conditions.length === 0) return 'None documented';

  return conditions
    .map((c) => {
      const name = c.code?.text || c.code?.coding?.[0]?.display || 'Unknown';
      const status = c.clinicalStatus?.coding?.[0]?.code || 'unknown';
      return `- ${name} (${status})`;
    })
    .join('\n');
}

/**
 * Format medications list
 */
function formatMedicationsList(medications: MedicationRequest[]): string {
  if (medications.length === 0) return 'None documented';

  return medications
    .map((m) => {
      const name =
        m.medicationCodeableConcept?.text || m.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown';
      const dosage = m.dosageInstruction?.[0]?.text || '';
      return `- ${name}${dosage ? `: ${dosage}` : ''}`;
    })
    .join('\n');
}

/**
 * Format allergies list
 */
function formatAllergiesList(allergies: AllergyIntolerance[]): string {
  if (allergies.length === 0) return 'NKDA (No Known Drug Allergies)';

  return allergies
    .map((a) => {
      const substance = a.code?.text || a.code?.coding?.[0]?.display || 'Unknown';
      const reaction = a.reaction?.[0]?.manifestation?.[0]?.text || '';
      return `- ${substance}${reaction ? ` (${reaction})` : ''}`;
    })
    .join('\n');
}

/**
 * Format vitals list
 */
function formatVitalsList(vitals: Observation[]): string {
  if (vitals.length === 0) return 'None documented';

  return vitals
    .slice(0, 10)
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
}

/**
 * Format labs list
 */
function formatLabsList(labs: Observation[]): string {
  if (labs.length === 0) return 'None documented';

  return labs
    .slice(0, 15)
    .map((l) => {
      const name = l.code?.text || l.code?.coding?.[0]?.display || 'Unknown';
      let value = '';
      if (l.valueQuantity) {
        value = `${l.valueQuantity.value} ${l.valueQuantity.unit || ''}`;
      } else if (l.valueString) {
        value = l.valueString;
      }
      const interpretation = l.interpretation?.[0]?.coding?.[0]?.code || '';
      const flag = interpretation === 'H' ? ' [HIGH]' : interpretation === 'L' ? ' [LOW]' : '';
      return `- ${name}: ${value}${flag}`;
    })
    .join('\n');
}

/**
 * Format procedures list
 */
function formatProceduresList(procedures: Procedure[]): string {
  if (procedures.length === 0) return 'None documented';

  return procedures
    .map((p) => {
      const name = p.code?.text || p.code?.coding?.[0]?.display || 'Unknown';
      const date = p.performedDateTime || p.performedPeriod?.start || '';
      return `- ${name}${date ? ` (${date.substring(0, 10)})` : ''}`;
    })
    .join('\n');
}

/**
 * Call the LLM
 */
async function callLLM(prompt: string): Promise<{ text: string; confidence: number }> {
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
          num_predict: 2000,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const result = await response.json() as { response?: string };

    // Estimate confidence based on response quality
    let confidence = 0.7;
    const text = result.response || '';

    // Lower confidence if many placeholders
    const placeholderCount = (text.match(/\[CLINICIAN TO COMPLETE\]/g) || []).length;
    confidence -= placeholderCount * 0.05;

    // Higher confidence if all sections present
    if (text.includes('ASSESSMENT') && text.includes('PLAN')) {
      confidence += 0.1;
    }

    return {
      text: text,
      confidence: Math.max(0.3, Math.min(0.9, confidence)),
    };
  } catch (error) {
    console.error('LLM call error:', error);
    return {
      text: 'Error generating document. Please try again.',
      confidence: 0,
    };
  }
}

/**
 * Parse sections from LLM response
 */
function parseSections(text: string, documentType: DocumentType): Record<string, string> {
  const sections: Record<string, string> = {};

  // Common section headers to look for
  const sectionPatterns = [
    'SUBJECTIVE',
    'OBJECTIVE',
    'ASSESSMENT',
    'PLAN',
    'CHIEF COMPLAINT',
    'HISTORY OF PRESENT ILLNESS',
    'PAST MEDICAL HISTORY',
    'MEDICATIONS',
    'ALLERGIES',
    'PHYSICAL EXAMINATION',
    'LABORATORY',
    'RECOMMENDATIONS',
    'DISCHARGE MEDICATIONS',
    'FOLLOW-UP',
    'DISCHARGE INSTRUCTIONS',
  ];

  for (const pattern of sectionPatterns) {
    const regex = new RegExp(`${pattern}[:\\s]*([\\s\\S]*?)(?=(?:${sectionPatterns.join('|')})|$)`, 'i');
    const match = text.match(regex);
    if (match && match[1]) {
      sections[pattern] = match[1].trim();
    }
  }

  return sections;
}

export default handler;
