# Record Importer Audit: Emily Smith

**Audit Date:** 2026-01-28
**Patient:** Emily Lauren Smith (DOB: 1991-06-27)
**FHIR Patient ID:** `65d76f1b-72b5-473e-aee4-0689859ba4bf`
**Import Batch:** `00095549-5047-4a4e-bf4d-36f16ccc4d97`
**Source System ID (pssuite):** `17067`
**Crosswalk ID:** `3b731000-fd1d-5bd6-8e0c-6996ac658974`

---

## Executive Summary

The patient demographic data imported correctly, but **all clinical resources are orphaned** due to incorrect patient references. Additionally, several data quality issues affect usability for analytics and AI evaluation.

| Issue | Severity | Impact |
|-------|----------|--------|
| Broken patient references | 🔴 Critical | Clinical data unreachable via standard FHIR queries |
| Missing LOINC codes (~41%) | 🟡 Medium | Reduced interoperability and AI accuracy |
| Qualitative results as numeric 0 | 🟡 Medium | Incorrect data representation |
| Missing resource types | 🟠 High | Incomplete clinical picture |

---

## Critical Issue: Broken Patient References

### Problem

All clinical resources reference the **crosswalk ID** instead of the actual **FHIR Patient ID**:

```
❌ Current:  subject.reference = "Patient/3b731000-fd1d-5bd6-8e0c-6996ac658974"
✅ Expected: subject.reference = "Patient/65d76f1b-72b5-473e-aee4-0689859ba4bf"
```

The crosswalk ID (`3b731000-fd1d-5bd6-8e0c-6996ac658974`) does not exist as a Patient resource, causing all clinical data to be orphaned.

### Affected Resources

| Resource Type | Count | Reference Field |
|---------------|-------|-----------------|
| Observation | 795 | `subject.reference` |
| DiagnosticReport | 61 | `subject.reference` |
| AllergyIntolerance | 1 | `patient.reference` |

### Impact

- Standard FHIR queries by patient ID return **zero results**
- `Patient/$everything` operation returns only the Patient resource
- Any application querying clinical data by patient will fail
- AI/analytics tools cannot aggregate patient data

### Suggested Fix

The importer should either:

1. **Use the FHIR Patient ID** in all resource references after creating/finding the Patient resource
2. **OR** Create the Patient resource with the crosswalk ID as its FHIR ID (if deterministic IDs are preferred)

Current flow appears to be:
```
1. Create Patient → gets FHIR ID: 65d76f1b-...
2. Store crosswalk ID in Patient.identifier
3. Create Observations → incorrectly uses crosswalk ID in subject.reference
```

Should be:
```
1. Create Patient → gets FHIR ID: 65d76f1b-...
2. Store crosswalk ID in Patient.identifier
3. Create Observations → uses FHIR ID (65d76f1b-...) in subject.reference
```

---

## Data Imported Successfully

### Patient Demographics ✅

```json
{
  "name": "Emily Lauren Smith",
  "gender": "female",
  "birthDate": "1991-06-27",
  "address": "287 B Dunsdon, Brantford, ON N3R 6A8, Canada",
  "email": "emilybrett11@gmail.com",
  "identifiers": [
    {"system": "patient-crosswalk", "value": "3b731000-fd1d-5bd6-8e0c-6996ac658974"},
    {"system": "pssuite-patient", "value": "17067"}
  ]
}
```

### Observations (Labs/Vitals) ⚠️

- **Count:** 795 observations
- **Date Range:** 2010-10-07 → 2024-07-11
- **Categories:** Laboratory tests

**Well-structured example (Hemoglobin):**
```json
{
  "code": {
    "coding": [{"system": "http://loinc.org", "code": "718-7", "display": "HEMOGLOBIN"}],
    "text": "HEMOGLOBIN"
  },
  "valueQuantity": {"value": 138, "unit": "G/L", "system": "http://unitsofmeasure.org"},
  "referenceRange": [{"low": {"value": 115, "unit": "G/L"}, "high": {"value": 160, "unit": "G/L"}}],
  "effectiveDateTime": "2013-08-26",
  "status": "final",
  "category": [{"coding": [{"code": "laboratory"}]}]
}
```

**Graphable data available:**
| Test | Data Points | Units | Has Reference Range |
|------|-------------|-------|---------------------|
| Hemoglobin | 8 | g/L | ✅ |
| WBC | Multiple | X10 9/L | ✅ |
| Platelets | Multiple | X10 9/L | ✅ |
| Glucose | Multiple | mmol/L | ✅ |
| Cholesterol | Multiple | mmol/L | ✅ |
| TSH | Multiple | mIU/L | ✅ |

### DiagnosticReports ✅

- **Count:** 61 reports
- **Date Range:** 2010-10-07 → 2025-12-17
- **Format:** LOINC coded with full text in `presentedForm` (base64)

Reports correctly preserve:
- Original report text (decoded example shows full microbiology report)
- Performer information
- Issue dates
- Links to individual Observations via `result` references

### AllergyIntolerance ✅

- **Count:** 1
- **Allergy:** Penicillins (medication allergy, high criticality)
- **Status:** Resolved, Confirmed
- **Onset:** 2010-10-06

---

## Data Quality Issues

### 1. Missing LOINC Codes (~41% of Observations)

**Problem:** 205 out of 500 sampled observations lack LOINC codes, using only `code.text`.

**Examples without LOINC:**
```json
{"code": {"text": "SOURCE"}, "valueQuantity": {"value": 0}}
{"code": {"text": "C.TRACHOMATIS"}, "valueQuantity": {"value": 0}}
{"code": {"text": "MICROSCOPY"}, "valueQuantity": {"value": 0}}
```

**Impact:**
- Harder to standardize for AI/analytics
- Cannot reliably aggregate across patients
- Reduced interoperability with other systems

**Suggestion:** Map common test names to LOINC codes during import. Consider using a LOINC lookup service or mapping table.

### 2. Qualitative Results Stored as Numeric Zero

**Problem:** Qualitative test results (Negative/Positive) are stored as `valueQuantity: {value: 0}` instead of `valueCodeableConcept`.

**Current (incorrect):**
```json
{
  "code": {"text": "C.TRACHOMATIS"},
  "valueQuantity": {"value": 0}  // What does 0 mean?
}
```

**Should be:**
```json
{
  "code": {"text": "C.TRACHOMATIS"},
  "valueCodeableConcept": {
    "coding": [{"system": "http://snomed.info/sct", "code": "260385009", "display": "Negative"}]
  }
}
```

**Affected tests:** Chlamydia, Gonorrhoeae, Trichomonas, Microscopy, Culture results

### 3. Missing Resource Types

| Resource Type | Expected | Imported | Notes |
|---------------|----------|----------|-------|
| Condition | Yes | ❌ 0 | No diagnoses/problem list |
| MedicationRequest | Yes | ❌ 0 | No prescriptions |
| Encounter | Yes | ❌ 0 | No visit records |
| Procedure | Maybe | ❌ 0 | |
| Immunization | Maybe | ❌ 0 | |

**Impact:**
- AI cannot assess diagnoses or medication history
- No context for when/why labs were ordered
- Drug interaction checking impossible

---

## Metadata Tags (Working Well)

The importer correctly tags resources with:
```json
{
  "meta": {
    "tag": [
      {"system": "import-batch", "code": "00095549-5047-4a4e-bf4d-36f16ccc4d97"},
      {"system": "managed-by", "code": "recordimporter"},
      {"system": "value-hash", "code": "..."},
      {"system": "document-fingerprint", "code": "..."}
    ]
  }
}
```

This enables:
- Tracking which batch imported each resource
- Deduplication via fingerprints
- Identifying importer-managed resources

---

## Recommendations Summary

### Must Fix (Critical)

1. **Fix patient references** - Use the FHIR Patient ID, not the crosswalk ID, in all `subject.reference` and `patient.reference` fields

### Should Fix (High Priority)

2. **Import Conditions** - Essential for clinical AI and decision support
3. **Import MedicationRequests** - Required for drug interaction checks
4. **Add LOINC codes** - Map text-only codes to LOINC for standardization

### Nice to Have

5. **Use valueCodeableConcept for qualitative results** - Store "Negative/Positive" properly
6. **Import Encounters** - Provides visit context for observations
7. **Consistent unit casing** - Some use "G/L", others "g/L"

---

## Test Queries

To verify the fix, these queries should return data:

```bash
# Should return 795 observations (currently returns 0)
GET /fhir/R4/Observation?subject=Patient/65d76f1b-72b5-473e-aee4-0689859ba4bf

# Should return all clinical data (currently returns only Patient)
GET /fhir/R4/Patient/65d76f1b-72b5-473e-aee4-0689859ba4bf/$everything

# Should return 61 reports (currently returns 0)
GET /fhir/R4/DiagnosticReport?subject=Patient/65d76f1b-72b5-473e-aee4-0689859ba4bf
```

---

## Appendix: Sample Data

### Hemoglobin Trend Data (for graphing validation)

| Date | Value | Unit | Reference Range |
|------|-------|------|-----------------|
| 2013-08-26 | 138 | G/L | 115-160 |
| 2021-01-14 | 144 | g/L | 115-160 |
| 2021-11-24 | 128 | g/L | 115-160 |
| 2022-03-28 | 116 | g/L | 115-160 |
| 2023-07-13 | 132 | g/L | 115-160 |
| 2023-10-13 | 133 | g/L | 115-160 |
| 2024-06-19 | 126 | g/L | 115-160 |
| 2024-07-11 | 122 | g/L | 115-160 |

### Available Test Types (140+ unique)

Common tests with data: Hemoglobin, WBC, RBC, Platelets, MCV, MCH, MCHC, Glucose, Creatinine, eGFR, ALT, AST, TSH, Free T4, Cholesterol, HDL, LDL, Triglycerides, HbA1c, Ferritin, Iron, Vitamin B12, and more.
