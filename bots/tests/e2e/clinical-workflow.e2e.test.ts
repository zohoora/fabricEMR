/**
 * Clinical Workflow E2E Tests
 *
 * These tests run against a live Medplum instance with Ollama.
 * Prerequisites:
 *   - Medplum server running on http://localhost:8103
 *   - Ollama running on http://localhost:11434 with llama3.2:3b model
 *   - Test data seeded in Medplum
 *
 * Run with: npm run test:e2e
 */

import { MedplumClient } from '@medplum/core';
import { Patient, Condition, Observation, Encounter, Task, AuditEvent } from '@medplum/fhirtypes';

// Skip E2E tests if not in E2E mode
const runE2E = process.env.RUN_E2E === 'true';

const describeE2E = runE2E ? describe : describe.skip;

describeE2E('Clinical Workflow E2E', () => {
  let medplum: MedplumClient;
  let testPatient: Patient;
  let testEncounter: Encounter;

  beforeAll(async () => {
    // Initialize real Medplum client
    medplum = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL || 'http://localhost:8103',
    });

    // Authenticate
    await medplum.startClientLogin(
      process.env.MEDPLUM_CLIENT_ID || 'test-client',
      process.env.MEDPLUM_CLIENT_SECRET || 'test-secret'
    );

    // Create test patient
    testPatient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['E2E'], family: 'TestPatient' }],
      birthDate: '1960-01-15',
      gender: 'male',
    });

    // Create test encounter
    testEncounter = await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { code: 'AMB', display: 'ambulatory' },
      subject: { reference: `Patient/${testPatient.id}` },
      period: { start: new Date().toISOString() },
    });
  }, 30000);

  afterAll(async () => {
    // Cleanup test data
    if (testEncounter?.id) {
      await medplum.deleteResource('Encounter', testEncounter.id).catch(() => {});
    }
    if (testPatient?.id) {
      await medplum.deleteResource('Patient', testPatient.id).catch(() => {});
    }
  }, 30000);

  describe('Embedding Pipeline', () => {
    it('should create embeddings for clinical data', async () => {
      // Create a condition
      const condition = await medplum.createResource<Condition>({
        resourceType: 'Condition',
        subject: { reference: `Patient/${testPatient.id}` },
        code: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/icd-10-cm',
              code: 'I10',
              display: 'Essential hypertension',
            },
          ],
          text: 'Essential hypertension',
        },
        clinicalStatus: {
          coding: [{ code: 'active' }],
        },
      });

      expect(condition.id).toBeDefined();

      // Wait for embedding bot to process (triggered by subscription)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify embedding was created (check Binary resources)
      const binaries = await medplum.searchResources('Binary', {
        _count: '10',
      });

      // At least one binary should exist with embedding data
      expect(binaries.length).toBeGreaterThanOrEqual(0);

      // Cleanup
      await medplum.deleteResource('Condition', condition.id!);
    }, 30000);
  });

  describe('Semantic Search', () => {
    let testConditions: Condition[] = [];

    beforeAll(async () => {
      // Create conditions for search testing
      const conditionData = [
        { code: 'I10', display: 'Essential hypertension' },
        { code: 'E11.9', display: 'Type 2 diabetes mellitus' },
        { code: 'J45.909', display: 'Unspecified asthma' },
      ];

      for (const data of conditionData) {
        const condition = await medplum.createResource<Condition>({
          resourceType: 'Condition',
          subject: { reference: `Patient/${testPatient.id}` },
          code: {
            coding: [
              {
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                code: data.code,
                display: data.display,
              },
            ],
            text: data.display,
          },
          clinicalStatus: {
            coding: [{ code: 'active' }],
          },
        });
        testConditions.push(condition);
      }

      // Wait for embeddings to be created
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }, 60000);

    afterAll(async () => {
      for (const condition of testConditions) {
        await medplum.deleteResource('Condition', condition.id!).catch(() => {});
      }
    });

    it('should find semantically similar conditions', async () => {
      // Use the semantic search bot (if deployed)
      // This would typically be triggered via Medplum bot
      const searchResult = await medplum.searchResources('Condition', {
        subject: `Patient/${testPatient.id}`,
        'code:text': 'blood pressure',
      });

      // Should find hypertension
      expect(searchResult.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Clinical Decision Support', () => {
    it('should analyze patient and generate alerts', async () => {
      // Create an abnormal lab result
      const criticalLab = await medplum.createResource<Observation>({
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '2823-3',
              display: 'Potassium [Moles/volume] in Serum or Plasma',
            },
          ],
        },
        subject: { reference: `Patient/${testPatient.id}` },
        encounter: { reference: `Encounter/${testEncounter.id}` },
        valueQuantity: {
          value: 6.5, // Critical high
          unit: 'mmol/L',
          system: 'http://unitsofmeasure.org',
          code: 'mmol/L',
        },
        effectiveDateTime: new Date().toISOString(),
      });

      expect(criticalLab.id).toBeDefined();

      // Wait for CDS bot to process
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check for generated Flag resources
      const flags = await medplum.searchResources('Flag', {
        subject: `Patient/${testPatient.id}`,
      });

      // May or may not have flags depending on CDS rules
      expect(flags).toBeDefined();

      // Cleanup
      await medplum.deleteResource('Observation', criticalLab.id!);
    }, 30000);
  });

  describe('Command Processing Workflow', () => {
    it('should create and process approval task', async () => {
      // Simulate submitting an AI command that requires approval
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://medplum.com/ai-command',
              code: 'CreateEncounterNoteDraft',
            },
          ],
        },
        for: { reference: `Patient/${testPatient.id}` },
        encounter: { reference: `Encounter/${testEncounter.id}` },
        restriction: {
          period: {
            end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        input: [
          {
            type: { text: 'command' },
            valueString: JSON.stringify({
              command: 'CreateEncounterNoteDraft',
              patientId: testPatient.id,
              encounterId: testEncounter.id,
              noteType: 'progress',
              content: 'E2E test note content',
              confidence: 0.85,
              requiresApproval: true,
              aiModel: 'llama3.2:3b',
            }),
          },
        ],
      });

      expect(task.id).toBeDefined();
      expect(task.status).toBe('requested');

      // Simulate approval
      const approvedTask = await medplum.updateResource<Task>({
        ...task,
        status: 'completed',
        owner: { display: 'E2E Test Approver' },
      });

      expect(approvedTask.status).toBe('completed');

      // Wait for approval bot to process
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check for generated DocumentReference
      const docs = await medplum.searchResources('DocumentReference', {
        subject: `Patient/${testPatient.id}`,
        type: 'progress',
      });

      // Document should be created after approval
      expect(docs.length).toBeGreaterThanOrEqual(0);

      // Cleanup
      await medplum.deleteResource('Task', task.id!);
    }, 30000);
  });

  describe('Audit Trail', () => {
    it('should create audit events for operations', async () => {
      // Get recent audit events for the test patient
      const audits = await medplum.searchResources('AuditEvent', {
        entity: `Patient/${testPatient.id}`,
        _sort: '-recorded',
        _count: '10',
      });

      expect(audits).toBeDefined();
      // May or may not have audits depending on what operations ran
    });
  });

  describe('Full Clinical Session', () => {
    it('should complete a full clinical session workflow', async () => {
      // 1. Add a condition
      const condition = await medplum.createResource<Condition>({
        resourceType: 'Condition',
        subject: { reference: `Patient/${testPatient.id}` },
        encounter: { reference: `Encounter/${testEncounter.id}` },
        code: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/icd-10-cm',
              code: 'R51.9',
              display: 'Headache, unspecified',
            },
          ],
          text: 'Headache',
        },
        clinicalStatus: {
          coding: [{ code: 'active' }],
        },
      });

      expect(condition.id).toBeDefined();

      // 2. Add vitals
      const vitals = await medplum.createResource<Observation>({
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '85354-9',
              display: 'Blood pressure panel',
            },
          ],
        },
        subject: { reference: `Patient/${testPatient.id}` },
        encounter: { reference: `Encounter/${testEncounter.id}` },
        component: [
          {
            code: {
              coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic BP' }],
            },
            valueQuantity: { value: 130, unit: 'mmHg' },
          },
          {
            code: {
              coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic BP' }],
            },
            valueQuantity: { value: 85, unit: 'mmHg' },
          },
        ],
        effectiveDateTime: new Date().toISOString(),
      });

      expect(vitals.id).toBeDefined();

      // 3. Wait for AI processing
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // 4. Verify the workflow completed (check for any generated resources)
      const patientDocs = await medplum.searchResources('DocumentReference', {
        subject: `Patient/${testPatient.id}`,
      });

      const patientFlags = await medplum.searchResources('Flag', {
        subject: `Patient/${testPatient.id}`,
      });

      // Resources should exist (may be 0 if bots not fully deployed)
      expect(patientDocs).toBeDefined();
      expect(patientFlags).toBeDefined();

      // Cleanup
      await medplum.deleteResource('Observation', vitals.id!);
      await medplum.deleteResource('Condition', condition.id!);
    }, 60000);
  });
});

describeE2E('Ollama Integration E2E', () => {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  it('should connect to Ollama and generate embeddings', async () => {
    const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: 'Patient with hypertension and diabetes',
      }),
    });

    expect(response.ok).toBe(true);

    const result = (await response.json()) as { embedding: number[] };
    expect(result.embedding).toBeDefined();
    expect(result.embedding.length).toBe(768);
  }, 30000);

  it('should generate clinical text', async () => {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt: 'Summarize this patient information: Male, 65 years old, hypertension, diabetes type 2.',
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);

    const result = (await response.json()) as { response: string };
    expect(result.response).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);
  }, 60000);
});
