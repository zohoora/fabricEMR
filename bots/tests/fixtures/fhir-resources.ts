/**
 * Test Fixtures - FHIR Resources
 *
 * Sample FHIR resources for testing AI bots.
 */

import {
  Patient,
  Condition,
  Observation,
  MedicationRequest,
  Encounter,
  DiagnosticReport,
  Task,
  DocumentReference,
  AllergyIntolerance,
  Procedure,
} from '@medplum/fhirtypes';

// ============================================
// PATIENTS
// ============================================

export const testPatient: Patient = {
  resourceType: 'Patient',
  id: 'test-patient-1',
  meta: {
    versionId: '1',
    lastUpdated: '2024-01-15T10:00:00Z',
  },
  identifier: [
    {
      type: { text: 'MRN' },
      value: 'MRN12345',
    },
  ],
  name: [
    {
      given: ['John', 'Michael'],
      family: 'Smith',
    },
  ],
  gender: 'male',
  birthDate: '1965-03-15',
};

export const pediatricPatient: Patient = {
  resourceType: 'Patient',
  id: 'test-patient-pediatric',
  name: [
    {
      given: ['Emma'],
      family: 'Johnson',
    },
  ],
  gender: 'female',
  birthDate: '2018-06-20',
};

// ============================================
// CONDITIONS
// ============================================

export const hypertensionCondition: Condition = {
  resourceType: 'Condition',
  id: 'condition-htn',
  clinicalStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
        code: 'active',
      },
    ],
  },
  verificationStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
        code: 'confirmed',
      },
    ],
  },
  code: {
    coding: [
      {
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
        code: 'I10',
        display: 'Essential (primary) hypertension',
      },
    ],
    text: 'Essential hypertension',
  },
  subject: { reference: 'Patient/test-patient-1' },
  onsetDateTime: '2020-01-15',
};

export const diabetesCondition: Condition = {
  resourceType: 'Condition',
  id: 'condition-dm',
  clinicalStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
        code: 'active',
      },
    ],
  },
  verificationStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
        code: 'confirmed',
      },
    ],
  },
  code: {
    coding: [
      {
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
        code: 'E11.9',
        display: 'Type 2 diabetes mellitus without complications',
      },
    ],
    text: 'Type 2 Diabetes Mellitus',
  },
  subject: { reference: 'Patient/test-patient-1' },
  onsetDateTime: '2019-06-01',
};

// ============================================
// OBSERVATIONS (VITALS)
// ============================================

export const bloodPressureObservation: Observation = {
  resourceType: 'Observation',
  id: 'obs-bp-1',
  status: 'final',
  category: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'vital-signs',
        },
      ],
    },
  ],
  code: {
    coding: [
      {
        system: 'http://loinc.org',
        code: '85354-9',
        display: 'Blood pressure panel',
      },
    ],
  },
  subject: { reference: 'Patient/test-patient-1' },
  effectiveDateTime: '2024-01-15T09:30:00Z',
  component: [
    {
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8480-6',
            display: 'Systolic blood pressure',
          },
        ],
      },
      valueQuantity: {
        value: 142,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]',
      },
    },
    {
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8462-4',
            display: 'Diastolic blood pressure',
          },
        ],
      },
      valueQuantity: {
        value: 92,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]',
      },
    },
  ],
};

export const criticalLabObservation: Observation = {
  resourceType: 'Observation',
  id: 'obs-lab-critical',
  status: 'final',
  category: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'laboratory',
        },
      ],
    },
  ],
  code: {
    coding: [
      {
        system: 'http://loinc.org',
        code: '2823-3',
        display: 'Potassium [Moles/volume] in Serum or Plasma',
      },
    ],
    text: 'Potassium',
  },
  subject: { reference: 'Patient/test-patient-1' },
  effectiveDateTime: '2024-01-15T08:00:00Z',
  valueQuantity: {
    value: 6.2,
    unit: 'mmol/L',
    system: 'http://unitsofmeasure.org',
    code: 'mmol/L',
  },
  interpretation: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          code: 'HH',
          display: 'Critical high',
        },
      ],
    },
  ],
  referenceRange: [
    {
      low: { value: 3.5, unit: 'mmol/L' },
      high: { value: 5.0, unit: 'mmol/L' },
    },
  ],
};

export const hba1cObservation: Observation = {
  resourceType: 'Observation',
  id: 'obs-hba1c',
  status: 'final',
  category: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'laboratory',
        },
      ],
    },
  ],
  code: {
    coding: [
      {
        system: 'http://loinc.org',
        code: '4548-4',
        display: 'Hemoglobin A1c',
      },
    ],
    text: 'HbA1c',
  },
  subject: { reference: 'Patient/test-patient-1' },
  effectiveDateTime: '2024-01-10T08:00:00Z',
  valueQuantity: {
    value: 7.2,
    unit: '%',
    system: 'http://unitsofmeasure.org',
    code: '%',
  },
  interpretation: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          code: 'H',
          display: 'High',
        },
      ],
    },
  ],
};

// ============================================
// MEDICATIONS
// ============================================

export const lisinoprilMedication: MedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'med-lisinopril',
  status: 'active',
  intent: 'order',
  medicationCodeableConcept: {
    coding: [
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '314076',
        display: 'Lisinopril 10 MG Oral Tablet',
      },
    ],
    text: 'Lisinopril 10mg',
  },
  subject: { reference: 'Patient/test-patient-1' },
  dosageInstruction: [
    {
      text: 'Take 1 tablet by mouth once daily',
      timing: {
        repeat: {
          frequency: 1,
          period: 1,
          periodUnit: 'd',
        },
      },
      doseAndRate: [
        {
          doseQuantity: {
            value: 10,
            unit: 'mg',
          },
        },
      ],
    },
  ],
};

export const metforminMedication: MedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'med-metformin',
  status: 'active',
  intent: 'order',
  medicationCodeableConcept: {
    coding: [
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '861007',
        display: 'Metformin 500 MG Oral Tablet',
      },
    ],
    text: 'Metformin 500mg',
  },
  subject: { reference: 'Patient/test-patient-1' },
  dosageInstruction: [
    {
      text: 'Take 1 tablet by mouth twice daily with meals',
      timing: {
        repeat: {
          frequency: 2,
          period: 1,
          periodUnit: 'd',
        },
      },
    },
  ],
};

// ============================================
// ENCOUNTERS
// ============================================

export const officeVisitEncounter: Encounter = {
  resourceType: 'Encounter',
  id: 'encounter-office-1',
  status: 'finished',
  class: {
    system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    code: 'AMB',
    display: 'ambulatory',
  },
  type: [
    {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '185349003',
          display: 'Encounter for check up',
        },
      ],
      text: 'Office Visit',
    },
  ],
  subject: { reference: 'Patient/test-patient-1' },
  period: {
    start: '2024-01-15T09:00:00Z',
    end: '2024-01-15T09:30:00Z',
  },
  reasonCode: [
    {
      text: 'Routine follow-up for hypertension and diabetes',
    },
  ],
};

// ============================================
// ALLERGIES
// ============================================

export const penicillinAllergy: AllergyIntolerance = {
  resourceType: 'AllergyIntolerance',
  id: 'allergy-pcn',
  clinicalStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
        code: 'active',
      },
    ],
  },
  verificationStatus: {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
        code: 'confirmed',
      },
    ],
  },
  type: 'allergy',
  category: ['medication'],
  criticality: 'high',
  code: {
    coding: [
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '7984',
        display: 'Penicillin',
      },
    ],
    text: 'Penicillin',
  },
  patient: { reference: 'Patient/test-patient-1' },
  reaction: [
    {
      manifestation: [
        {
          text: 'Anaphylaxis',
        },
      ],
      severity: 'severe',
    },
  ],
};

// ============================================
// TASKS (for approval workflow)
// ============================================

export const pendingApprovalTask: Task = {
  resourceType: 'Task',
  id: 'task-approval-1',
  status: 'requested',
  intent: 'proposal',
  priority: 'routine',
  code: {
    coding: [
      {
        system: 'http://medplum.com/fhir/CodeSystem/ai-command',
        code: 'CreateEncounterNoteDraft',
        display: 'AI Command: CreateEncounterNoteDraft',
      },
    ],
  },
  description: 'AI-generated CreateEncounterNoteDraft requiring approval',
  authoredOn: '2024-01-15T10:00:00Z',
  lastModified: '2024-01-15T10:00:00Z',
  for: { reference: 'Patient/test-patient-1' },
  restriction: {
    period: {
      end: '2099-01-16T10:00:00Z', // Far future date for pending task tests
    },
  },
  input: [
    {
      type: { text: 'command' },
      valueString: JSON.stringify({
        command: 'CreateEncounterNoteDraft',
        patientId: 'test-patient-1',
        encounterId: 'encounter-office-1',
        noteType: 'progress',
        content: 'Test note content',
        confidence: 0.85,
        requiresApproval: true,
        aiModel: 'llama3.2:3b',
      }),
    },
    {
      type: { text: 'commandId' },
      valueString: 'cmd-test-123',
    },
    {
      type: { text: 'confidence' },
      valueDecimal: 0.85,
    },
  ],
};

// ============================================
// DIAGNOSTIC REPORTS
// ============================================

export const labReport: DiagnosticReport = {
  resourceType: 'DiagnosticReport',
  id: 'report-lab-1',
  status: 'final',
  category: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
          code: 'LAB',
          display: 'Laboratory',
        },
      ],
    },
  ],
  code: {
    coding: [
      {
        system: 'http://loinc.org',
        code: '24323-8',
        display: 'Comprehensive metabolic panel',
      },
    ],
    text: 'Comprehensive Metabolic Panel',
  },
  subject: { reference: 'Patient/test-patient-1' },
  effectiveDateTime: '2024-01-15T08:00:00Z',
  issued: '2024-01-15T12:00:00Z',
  result: [
    { reference: 'Observation/obs-lab-critical' },
  ],
  conclusion: 'Critical potassium level detected. Immediate clinical attention required.',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all test conditions
 */
export function getAllTestConditions(): Condition[] {
  return [hypertensionCondition, diabetesCondition];
}

/**
 * Get all test observations
 */
export function getAllTestObservations(): Observation[] {
  return [bloodPressureObservation, criticalLabObservation, hba1cObservation];
}

/**
 * Get all test medications
 */
export function getAllTestMedications(): MedicationRequest[] {
  return [lisinoprilMedication, metforminMedication];
}

/**
 * Create a complete patient context for testing
 */
export function createTestPatientContext() {
  return {
    patient: testPatient,
    conditions: getAllTestConditions(),
    observations: getAllTestObservations(),
    medications: getAllTestMedications(),
    allergies: [penicillinAllergy],
    encounters: [officeVisitEncounter],
  };
}
