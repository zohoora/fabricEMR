/**
 * Clinical Decision Support Bot
 *
 * Provides AI-powered clinical decision support by analyzing patient data
 * and suggesting diagnoses, treatments, or flagging potential issues.
 *
 * Input: { patientId: string, encounterType?: string, chiefComplaint?: string }
 * Output: Array of CDS suggestions
 */

import { BotEvent, MedplumClient } from '@medplum/core';
import {
  Patient,
  Condition,
  Observation,
  MedicationStatement,
  AllergyIntolerance,
} from '@medplum/fhirtypes';
import {
  AICommand,
  FlagAbnormalResult,
  ProposeProblemListUpdate,
  SuggestMedicationChange,
} from './types/ai-command-types';

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';

interface CDSInput {
  patientId: string;
  encounterType?: string;
  chiefComplaint?: string;
  focusArea?: 'diagnosis' | 'medication' | 'preventive' | 'all';
}

interface CDSSuggestion {
  type: 'diagnosis' | 'medication' | 'alert' | 'preventive' | 'order';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rationale: string;
  confidence: number;
  suggestedAction?: AICommand;
  references?: string[];
}

interface CDSOutput {
  success: boolean;
  patientId: string;
  suggestions: CDSSuggestion[];
  analysisTimestamp: string;
  model: string;
}

/**
 * Main bot handler
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<CDSOutput> {
  const input = event.input as CDSInput;

  if (!input?.patientId) {
    return {
      success: false,
      patientId: '',
      suggestions: [],
      analysisTimestamp: new Date().toISOString(),
      model: LLM_MODEL,
    };
  }

  console.log(`CDS analysis for patient: ${input.patientId}`);

  try {
    // Gather patient data
    const patientData = await gatherPatientData(medplum, input.patientId);

    // Run CDS analyses
    const suggestions: CDSSuggestion[] = [];

    const focusArea = input.focusArea || 'all';

    if (focusArea === 'all' || focusArea === 'diagnosis') {
      const diagnosisSuggestions = await analyzeDiagnosis(patientData, input.chiefComplaint);
      suggestions.push(...diagnosisSuggestions);
    }

    if (focusArea === 'all' || focusArea === 'medication') {
      const medicationSuggestions = await analyzeMedications(patientData);
      suggestions.push(...medicationSuggestions);
    }

    if (focusArea === 'all' || focusArea === 'preventive') {
      const preventiveSuggestions = analyzePreventiveCare(patientData);
      suggestions.push(...preventiveSuggestions);
    }

    // Check for critical alerts (always run)
    const alerts = analyzeForAlerts(patientData);
    suggestions.push(...alerts);

    // Sort by priority and confidence
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.confidence - a.confidence;
    });

    return {
      success: true,
      patientId: input.patientId,
      suggestions,
      analysisTimestamp: new Date().toISOString(),
      model: LLM_MODEL,
    };
  } catch (error) {
    console.error('CDS error:', error);
    return {
      success: false,
      patientId: input.patientId,
      suggestions: [],
      analysisTimestamp: new Date().toISOString(),
      model: LLM_MODEL,
    };
  }
}

interface PatientData {
  patient: Patient;
  conditions: Condition[];
  medications: MedicationStatement[];
  allergies: AllergyIntolerance[];
  vitals: Observation[];
  labs: Observation[];
}

/**
 * Gather comprehensive patient data
 */
async function gatherPatientData(medplum: MedplumClient, patientId: string): Promise<PatientData> {
  const [patient, conditions, medications, allergies, vitals, labs] = await Promise.all([
    medplum.readResource('Patient', patientId),
    medplum.searchResources('Condition', {
      patient: `Patient/${patientId}`,
      'clinical-status': 'active',
      _count: '50',
    }),
    medplum.searchResources('MedicationStatement', {
      patient: `Patient/${patientId}`,
      status: 'active',
      _count: '50',
    }),
    medplum.searchResources('AllergyIntolerance', {
      patient: `Patient/${patientId}`,
      'clinical-status': 'active',
      _count: '50',
    }),
    medplum.searchResources('Observation', {
      patient: `Patient/${patientId}`,
      category: 'vital-signs',
      _sort: '-date',
      _count: '20',
    }),
    medplum.searchResources('Observation', {
      patient: `Patient/${patientId}`,
      category: 'laboratory',
      _sort: '-date',
      _count: '30',
    }),
  ]);

  return { patient, conditions, medications, allergies, vitals, labs };
}

/**
 * Analyze for potential diagnoses
 */
async function analyzeDiagnosis(
  data: PatientData,
  chiefComplaint?: string
): Promise<CDSSuggestion[]> {
  const suggestions: CDSSuggestion[] = [];

  if (!chiefComplaint) {
    return suggestions;
  }

  // Build context for LLM
  const context = buildDiagnosisContext(data, chiefComplaint);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: context,
        stream: false,
        options: { temperature: 0.3, num_predict: 500 },
      }),
    });

    if (response.ok) {
      const result = await response.json() as { response: string };
      const parsed = parseDiagnosisSuggestions(result.response, data.patient.id!);
      suggestions.push(...parsed);
    }
  } catch (error) {
    console.error('Diagnosis analysis error:', error);
  }

  return suggestions;
}

/**
 * Build diagnosis context prompt
 */
function buildDiagnosisContext(data: PatientData, chiefComplaint: string): string {
  const conditions = data.conditions
    .map((c) => c.code?.text || c.code?.coding?.[0]?.display)
    .filter(Boolean)
    .join(', ');

  const medications = data.medications
    .map((m) => m.medicationCodeableConcept?.text || m.medicationCodeableConcept?.coding?.[0]?.display)
    .filter(Boolean)
    .join(', ');

  return `You are a clinical decision support AI. Based on the patient data below, suggest up to 3 possible differential diagnoses for the chief complaint. Be conservative and only suggest diagnoses supported by the data.

PATIENT DATA:
- Age: ${calculateAge(data.patient.birthDate)}
- Gender: ${data.patient.gender}
- Active Conditions: ${conditions || 'None documented'}
- Current Medications: ${medications || 'None documented'}
- Chief Complaint: ${chiefComplaint}

Provide your response in this exact format for each suggestion:
DIAGNOSIS: [diagnosis name]
ICD10: [ICD-10 code if known, or "unknown"]
CONFIDENCE: [low/medium/high]
RATIONALE: [brief clinical reasoning]
---

Only provide suggestions you are confident about. Do not make up information.`;
}

/**
 * Parse diagnosis suggestions from LLM response
 */
function parseDiagnosisSuggestions(response: string, patientId: string): CDSSuggestion[] {
  const suggestions: CDSSuggestion[] = [];
  const blocks = response.split('---').filter((b) => b.trim());

  for (const block of blocks) {
    const diagnosisMatch = block.match(/DIAGNOSIS:\s*(.+)/i);
    const icd10Match = block.match(/ICD10:\s*(.+)/i);
    const confidenceMatch = block.match(/CONFIDENCE:\s*(.+)/i);
    const rationaleMatch = block.match(/RATIONALE:\s*(.+)/i);

    if (diagnosisMatch) {
      const confidenceText = confidenceMatch?.[1]?.toLowerCase().trim() || 'medium';
      const confidence =
        confidenceText === 'high' ? 0.85 : confidenceText === 'medium' ? 0.7 : 0.55;

      const suggestion: CDSSuggestion = {
        type: 'diagnosis',
        priority: confidence > 0.8 ? 'high' : confidence > 0.6 ? 'medium' : 'low',
        title: `Consider: ${diagnosisMatch[1].trim()}`,
        description: `Possible diagnosis based on presenting symptoms and patient history.`,
        rationale: rationaleMatch?.[1]?.trim() || 'Based on clinical presentation',
        confidence,
      };

      // Create suggested action if ICD-10 code is available
      const icd10 = icd10Match?.[1]?.trim();
      if (icd10 && icd10 !== 'unknown') {
        suggestion.suggestedAction = {
          command: 'ProposeProblemListUpdate',
          patientId,
          action: 'add',
          condition: {
            code: icd10,
            system: 'http://hl7.org/fhir/sid/icd-10-cm',
            display: diagnosisMatch[1].trim(),
          },
          reasoning: suggestion.rationale,
          confidence,
          requiresApproval: true,
          createdAt: new Date().toISOString(),
          aiModel: LLM_MODEL,
        } as ProposeProblemListUpdate;
      }

      suggestions.push(suggestion);
    }
  }

  return suggestions.slice(0, 3); // Limit to 3 suggestions
}

/**
 * Analyze medications for interactions and issues
 */
async function analyzeMedications(data: PatientData): Promise<CDSSuggestion[]> {
  const suggestions: CDSSuggestion[] = [];

  // Check for common drug-drug interactions (simplified)
  const medNames = data.medications.map(
    (m) =>
      m.medicationCodeableConcept?.coding?.[0]?.display?.toLowerCase() ||
      m.medicationCodeableConcept?.text?.toLowerCase() ||
      ''
  );

  // Example interaction checks (in production, use a drug database)
  const knownInteractions: Array<{ drugs: string[]; severity: string; description: string }> = [
    {
      drugs: ['warfarin', 'aspirin'],
      severity: 'major',
      description: 'Increased risk of bleeding when combining warfarin with aspirin',
    },
    {
      drugs: ['metformin', 'contrast'],
      severity: 'major',
      description: 'Metformin should be held before contrast procedures',
    },
    {
      drugs: ['lisinopril', 'potassium'],
      severity: 'moderate',
      description: 'ACE inhibitors can increase potassium levels',
    },
    {
      drugs: ['simvastatin', 'amlodipine'],
      severity: 'moderate',
      description: 'Increased risk of myopathy with high-dose simvastatin and amlodipine',
    },
  ];

  for (const interaction of knownInteractions) {
    const found = interaction.drugs.filter((d) => medNames.some((m) => m.includes(d)));
    if (found.length >= 2) {
      suggestions.push({
        type: 'medication',
        priority: interaction.severity === 'major' ? 'high' : 'medium',
        title: `Drug Interaction Alert: ${found.join(' + ')}`,
        description: interaction.description,
        rationale: 'Based on known drug-drug interaction database',
        confidence: 0.95,
      });
    }
  }

  // Check for duplicate therapy
  const medClasses = new Map<string, string[]>();
  for (const med of data.medications) {
    const code = med.medicationCodeableConcept?.coding?.[0]?.code;
    const display = med.medicationCodeableConcept?.text || med.medicationCodeableConcept?.coding?.[0]?.display;
    if (code && display) {
      // Simplified class detection (in production, use proper classification)
      const classes = detectDrugClass(display);
      for (const cls of classes) {
        if (!medClasses.has(cls)) {
          medClasses.set(cls, []);
        }
        medClasses.get(cls)!.push(display);
      }
    }
  }

  for (const [cls, meds] of medClasses) {
    if (meds.length > 1) {
      suggestions.push({
        type: 'medication',
        priority: 'medium',
        title: `Potential Duplicate Therapy: ${cls}`,
        description: `Multiple medications in same class: ${meds.join(', ')}`,
        rationale: 'Review for potential duplicate therapy or intentional combination',
        confidence: 0.8,
      });
    }
  }

  return suggestions;
}

/**
 * Detect drug class (simplified)
 */
function detectDrugClass(drugName: string): string[] {
  const classes: string[] = [];
  const name = drugName.toLowerCase();

  if (name.includes('statin') || ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin'].some((s) => name.includes(s))) {
    classes.push('HMG-CoA Reductase Inhibitors (Statins)');
  }
  if (name.includes('pril') || ['lisinopril', 'enalapril', 'ramipril'].some((s) => name.includes(s))) {
    classes.push('ACE Inhibitors');
  }
  if (name.includes('sartan') || ['losartan', 'valsartan', 'irbesartan'].some((s) => name.includes(s))) {
    classes.push('ARBs');
  }
  if (['metformin', 'glipizide', 'glyburide', 'sitagliptin'].some((s) => name.includes(s))) {
    classes.push('Diabetes Medications');
  }
  if (['omeprazole', 'pantoprazole', 'esomeprazole', 'lansoprazole'].some((s) => name.includes(s))) {
    classes.push('Proton Pump Inhibitors');
  }

  return classes;
}

/**
 * Analyze preventive care gaps
 */
function analyzePreventiveCare(data: PatientData): CDSSuggestion[] {
  const suggestions: CDSSuggestion[] = [];
  const age = calculateAge(data.patient.birthDate);
  const gender = data.patient.gender;

  // Age-based screening recommendations
  if (age >= 50 && age <= 75) {
    // Check for colonoscopy
    const hasColonoscopy = data.conditions.some((c) =>
      c.code?.text?.toLowerCase().includes('colonoscopy')
    );
    if (!hasColonoscopy) {
      suggestions.push({
        type: 'preventive',
        priority: 'low',
        title: 'Colorectal Cancer Screening Due',
        description: 'Patient is due for colorectal cancer screening (age 50-75)',
        rationale: 'USPSTF Grade A recommendation for adults 50-75',
        confidence: 0.9,
      });
    }
  }

  if (gender === 'female' && age >= 21 && age <= 65) {
    suggestions.push({
      type: 'preventive',
      priority: 'low',
      title: 'Cervical Cancer Screening',
      description: 'Verify cervical cancer screening is up to date',
      rationale: 'USPSTF recommendation for women 21-65',
      confidence: 0.85,
    });
  }

  if (age >= 65) {
    suggestions.push({
      type: 'preventive',
      priority: 'low',
      title: 'Pneumococcal Vaccination',
      description: 'Verify pneumococcal vaccination status for patient 65+',
      rationale: 'CDC/ACIP recommendation for adults 65 and older',
      confidence: 0.9,
    });
  }

  // Check diabetes screening
  if (age >= 35 && age <= 70) {
    const hasDiabetes = data.conditions.some(
      (c) =>
        c.code?.text?.toLowerCase().includes('diabetes') ||
        c.code?.coding?.[0]?.code?.startsWith('E11')
    );
    const hasRecentA1c = data.labs.some(
      (l) =>
        l.code?.coding?.[0]?.code === '4548-4' && // HbA1c LOINC
        isWithinMonths(l.effectiveDateTime, 12)
    );

    if (!hasDiabetes && !hasRecentA1c) {
      suggestions.push({
        type: 'preventive',
        priority: 'low',
        title: 'Diabetes Screening',
        description: 'Consider diabetes screening (HbA1c) for patient age 35-70',
        rationale: 'USPSTF Grade B recommendation',
        confidence: 0.8,
      });
    }
  }

  return suggestions;
}

/**
 * Analyze for critical alerts
 */
function analyzeForAlerts(data: PatientData): CDSSuggestion[] {
  const alerts: CDSSuggestion[] = [];

  // Check vital signs for critical values
  for (const vital of data.vitals) {
    const code = vital.code?.coding?.[0]?.code;
    const value = vital.valueQuantity?.value;

    if (!value) continue;

    // Blood pressure
    if (code === '85354-9' || vital.code?.text?.toLowerCase().includes('blood pressure')) {
      // This would need component parsing for systolic/diastolic
    }

    // Heart rate
    if (code === '8867-4' || vital.code?.text?.toLowerCase().includes('heart rate')) {
      if (value < 50 || value > 120) {
        alerts.push({
          type: 'alert',
          priority: value < 40 || value > 150 ? 'high' : 'medium',
          title: `Abnormal Heart Rate: ${value} bpm`,
          description: `Heart rate outside normal range (60-100 bpm)`,
          rationale: 'Bradycardia or tachycardia may require evaluation',
          confidence: 0.95,
          suggestedAction: {
            command: 'FlagAbnormalResult',
            patientId: data.patient.id!,
            observationId: vital.id!,
            severity: value < 40 || value > 150 ? 'critical' : 'medium',
            interpretation: `Heart rate of ${value} bpm is ${value < 60 ? 'low (bradycardia)' : 'high (tachycardia)'}`,
            requiresApproval: false,
            createdAt: new Date().toISOString(),
            aiModel: LLM_MODEL,
            confidence: 0.95,
          } as FlagAbnormalResult,
        });
      }
    }

    // Oxygen saturation
    if (code === '2708-6' || vital.code?.text?.toLowerCase().includes('oxygen')) {
      if (value < 92) {
        alerts.push({
          type: 'alert',
          priority: value < 88 ? 'high' : 'medium',
          title: `Low Oxygen Saturation: ${value}%`,
          description: 'SpO2 below normal range',
          rationale: 'Hypoxemia requires immediate evaluation',
          confidence: 0.95,
          suggestedAction: {
            command: 'FlagAbnormalResult',
            patientId: data.patient.id!,
            observationId: vital.id!,
            severity: value < 88 ? 'critical' : 'high',
            interpretation: `Oxygen saturation of ${value}% indicates hypoxemia`,
            requiresApproval: false,
            createdAt: new Date().toISOString(),
            aiModel: LLM_MODEL,
            confidence: 0.95,
          } as FlagAbnormalResult,
        });
      }
    }
  }

  // Check labs for critical values
  for (const lab of data.labs) {
    const code = lab.code?.coding?.[0]?.code;
    const value = lab.valueQuantity?.value;
    const name = lab.code?.text || lab.code?.coding?.[0]?.display || 'Lab';

    if (!value) continue;

    // Potassium
    if (code === '2823-3' || name.toLowerCase().includes('potassium')) {
      if (value < 3.0 || value > 6.0) {
        alerts.push({
          type: 'alert',
          priority: value < 2.5 || value > 6.5 ? 'high' : 'medium',
          title: `Abnormal Potassium: ${value} mEq/L`,
          description: value < 3.5 ? 'Hypokalemia' : 'Hyperkalemia',
          rationale: 'Electrolyte abnormality may cause cardiac arrhythmias',
          confidence: 0.95,
        });
      }
    }

    // Creatinine (simplified - should consider baseline)
    if (code === '2160-0' || name.toLowerCase().includes('creatinine')) {
      if (value > 2.0) {
        alerts.push({
          type: 'alert',
          priority: value > 4.0 ? 'high' : 'medium',
          title: `Elevated Creatinine: ${value} mg/dL`,
          description: 'Possible acute kidney injury or chronic kidney disease',
          rationale: 'Elevated creatinine requires evaluation of renal function',
          confidence: 0.85,
        });
      }
    }

    // Hemoglobin
    if (code === '718-7' || name.toLowerCase().includes('hemoglobin')) {
      if (value < 7.0 || value > 18.0) {
        alerts.push({
          type: 'alert',
          priority: value < 7.0 ? 'high' : 'medium',
          title: `Abnormal Hemoglobin: ${value} g/dL`,
          description: value < 7.0 ? 'Severe anemia' : 'Polycythemia',
          rationale: 'Significant hemoglobin abnormality requires evaluation',
          confidence: 0.9,
        });
      }
    }
  }

  return alerts;
}

/**
 * Calculate age from birth date
 */
function calculateAge(birthDate?: string): number {
  if (!birthDate) return 0;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Check if date is within specified months
 */
function isWithinMonths(date?: string, months: number = 12): boolean {
  if (!date) return false;
  const d = new Date(date);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return d >= cutoff;
}

export default handler;
