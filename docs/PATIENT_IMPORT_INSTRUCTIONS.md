# Patient Import Instructions for Record Importer

## Problem

The current importer creates Observations that reference patients like `Patient/pssuite-patient-19562`, but **no actual Patient resource is created**. This means:
- Patients don't appear in patient searches
- Patient demographics are lost in Observation valueStrings
- FHIR references are broken (pointing to non-existent resources)

## Solution: Create Patient Resources First

### Step 1: Create the Patient Resource BEFORE Observations

When importing records, **always create the Patient resource first**, then reference it in Observations.

```typescript
import { MedplumClient } from '@medplum/core';
import { Patient, Observation } from '@medplum/fhirtypes';

async function importPatientWithRecords(
  medplum: MedplumClient,
  patientData: {
    mrn: string;
    familyName: string;
    givenName: string;
    birthDate?: string;
    gender?: 'male' | 'female' | 'other' | 'unknown';
  },
  observations: Array<{ code: string; value: string; date: string }>
) {
  // STEP 1: Check if patient already exists by MRN
  const existingPatients = await medplum.searchResources('Patient', {
    identifier: `urn:pssuite:mrn|${patientData.mrn}`,
  });

  let patient: Patient;

  if (existingPatients.length > 0) {
    // Patient exists - use existing
    patient = existingPatients[0];
  } else {
    // STEP 2: Create new Patient resource
    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      identifier: [
        {
          system: 'urn:pssuite:mrn',  // Use consistent system for MRN
          value: patientData.mrn,
        },
      ],
      name: [
        {
          use: 'official',
          family: patientData.familyName,
          given: [patientData.givenName],
          text: `${patientData.givenName} ${patientData.familyName}`,
        },
      ],
      birthDate: patientData.birthDate,
      gender: patientData.gender,
      active: true,
    });
  }

  // STEP 3: Create Observations linked to the REAL patient
  for (const obs of observations) {
    await medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      subject: {
        reference: `Patient/${patient.id}`,  // Reference the ACTUAL patient ID
        display: `${patientData.givenName} ${patientData.familyName}`,
      },
      code: {
        text: obs.code,
      },
      valueString: obs.value,
      effectiveDateTime: obs.date,
    });
  }

  return patient;
}
```

### Step 2: Patient Resource Structure

A properly structured Patient resource for Medplum:

```json
{
  "resourceType": "Patient",
  "identifier": [
    {
      "system": "urn:pssuite:mrn",
      "value": "H002340116"
    },
    {
      "system": "urn:pssuite:patient-id",
      "value": "19562"
    }
  ],
  "name": [
    {
      "use": "official",
      "family": "Foster",
      "given": ["Mirella", "Anne"],
      "text": "Mirella Anne Foster"
    }
  ],
  "gender": "female",
  "birthDate": "1985-03-15",
  "active": true
}
```

### Key Fields Explained

| Field | Required | Description |
|-------|----------|-------------|
| `resourceType` | Yes | Must be `"Patient"` |
| `identifier` | Yes | Array of identifiers - use for deduplication |
| `identifier[].system` | Yes | URI identifying the source system |
| `identifier[].value` | Yes | The actual ID (MRN, patient ID, etc.) |
| `name` | Yes | Array of HumanName objects |
| `name[].family` | Yes | Last name |
| `name[].given` | Yes | Array of first/middle names |
| `active` | Recommended | Set to `true` for active patients |
| `gender` | Recommended | `male`, `female`, `other`, `unknown` |
| `birthDate` | Recommended | Format: `YYYY-MM-DD` |

## Identifier Strategy for Deduplication

**Critical**: Use identifiers to prevent duplicate patients.

```typescript
// Define your identifier systems
const IDENTIFIER_SYSTEMS = {
  MRN: 'urn:pssuite:mrn',           // Medical Record Number
  PATIENT_ID: 'urn:pssuite:patient-id',  // External system patient ID
  ACCOUNT: 'urn:pssuite:account',   // Account numbers
};

// Search for existing patient before creating
async function findOrCreatePatient(
  medplum: MedplumClient,
  mrn: string,
  patientData: Partial<Patient>
): Promise<Patient> {
  // Search by MRN first
  const existing = await medplum.searchResources('Patient', {
    identifier: `${IDENTIFIER_SYSTEMS.MRN}|${mrn}`,
  });

  if (existing.length > 0) {
    console.log(`Found existing patient: ${existing[0].id}`);
    return existing[0];
  }

  // Create new patient with identifier
  const newPatient = await medplum.createResource<Patient>({
    resourceType: 'Patient',
    identifier: [
      { system: IDENTIFIER_SYSTEMS.MRN, value: mrn },
    ],
    ...patientData,
  });

  console.log(`Created new patient: ${newPatient.id}`);
  return newPatient;
}
```

## Parsing Patient Data from Lab Records

Extract patient info from strings like `"Patient Name: FOSTER,MIRELLA ANNE   HR#: H002340116"`:

```typescript
interface ParsedPatientData {
  familyName: string;
  givenNames: string[];
  mrn: string;
  accountNumber?: string;
}

function parsePatientFromLabHeader(headerLine: string): ParsedPatientData | null {
  // Pattern: "LASTNAME,FIRSTNAME MIDDLE   HR#: XXXXXX"
  const nameMatch = headerLine.match(/(?:Patient Name:|Name:)\s*([A-Z]+),\s*([A-Z\s]+)/i);
  const mrnMatch = headerLine.match(/(?:HR#|MRN|Unit Number):\s*([A-Z0-9]+)/i);
  const accountMatch = headerLine.match(/Acct#:\s*([A-Z0-9\/]+)/i);

  if (!nameMatch) return null;

  const familyName = nameMatch[1].trim();
  const givenParts = nameMatch[2].trim().split(/\s+/);

  return {
    familyName: toTitleCase(familyName),
    givenNames: givenParts.map(toTitleCase),
    mrn: mrnMatch?.[1] || '',
    accountNumber: accountMatch?.[1],
  };
}

function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Usage
const parsed = parsePatientFromLabHeader(
  "Patient Name: FOSTER,MIRELLA ANNE   HR#: H002340116"
);
// Result: { familyName: "Foster", givenNames: ["Mirella", "Anne"], mrn: "H002340116" }
```

## Complete Import Flow

```typescript
async function importLabRecord(
  medplum: MedplumClient,
  labRecord: {
    patientHeader: string;
    results: Array<{ testName: string; value: string; date: string }>;
  }
) {
  // 1. Parse patient data from header
  const patientData = parsePatientFromLabHeader(labRecord.patientHeader);
  if (!patientData || !patientData.mrn) {
    throw new Error('Could not parse patient data from record');
  }

  // 2. Find or create patient
  const patient = await findOrCreatePatient(medplum, patientData.mrn, {
    name: [{
      use: 'official',
      family: patientData.familyName,
      given: patientData.givenNames,
      text: `${patientData.givenNames.join(' ')} ${patientData.familyName}`,
    }],
    active: true,
  });

  // 3. Create observations linked to patient
  const observations = await Promise.all(
    labRecord.results.map(result =>
      medplum.createResource<Observation>({
        resourceType: 'Observation',
        status: 'final',
        subject: {
          reference: `Patient/${patient.id}`,
          display: patient.name?.[0]?.text,
        },
        code: { text: result.testName },
        valueString: result.value,
        effectiveDateTime: result.date,
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory',
          }],
        }],
      })
    )
  );

  return { patient, observations };
}
```

## Migration: Fix Existing Orphaned Observations

To fix the existing observations that reference `Patient/pssuite-patient-19562`:

```typescript
async function migrateOrphanedObservations(medplum: MedplumClient) {
  // 1. Find all observations with pssuite patient references
  const orphanedObs = await medplum.searchResources('Observation', {
    subject: 'Patient/pssuite-patient-19562',
    _count: '1000',
  });

  // 2. Extract patient data from observations
  const patientObs = orphanedObs.find(
    obs => obs.code?.text === 'Patient Name' || obs.code?.text === 'Name'
  );

  if (!patientObs?.valueString) {
    throw new Error('Could not find patient name observation');
  }

  const patientData = parsePatientFromLabHeader(patientObs.valueString);
  if (!patientData?.mrn) {
    throw new Error('Could not parse patient MRN');
  }

  // 3. Create the real patient
  const patient = await findOrCreatePatient(medplum, patientData.mrn, {
    name: [{
      use: 'official',
      family: patientData.familyName,
      given: patientData.givenNames,
    }],
    active: true,
  });

  // 4. Update all observations to reference the real patient
  for (const obs of orphanedObs) {
    await medplum.updateResource({
      ...obs,
      subject: {
        reference: `Patient/${patient.id}`,
        display: `${patientData.givenNames.join(' ')} ${patientData.familyName}`,
      },
    });
  }

  console.log(`Migrated ${orphanedObs.length} observations to Patient/${patient.id}`);
  return patient;
}
```

## Summary Checklist

- [ ] **Always create Patient resource FIRST** before any clinical resources
- [ ] **Use identifiers** (MRN, external IDs) for deduplication
- [ ] **Search before creating** to avoid duplicate patients
- [ ] **Reference actual Patient IDs** in Observation.subject (e.g., `Patient/abc-123`)
- [ ] **Never use made-up references** like `Patient/pssuite-patient-19562` without creating the resource
- [ ] **Parse and structure names properly** (family, given, text)
- [ ] **Include display text** in references for readability

## Medplum API Reference

- [Patient Resource](https://www.medplum.com/docs/api/fhir/resources/patient)
- [Observation Resource](https://www.medplum.com/docs/api/fhir/resources/observation)
- [FHIR Search](https://www.medplum.com/docs/search/basic-search)
- [Medplum TypeScript SDK](https://www.medplum.com/docs/sdk/core)
