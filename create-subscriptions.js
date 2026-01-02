const fs = require('fs');

const TOKEN = fs.readFileSync('/tmp/token.json', 'utf8');
const ACCESS_TOKEN = JSON.parse(TOKEN).access_token;
const API_URL = 'http://localhost:8103';

// Bot IDs
const BOTS = {
  embedding: 'd089f714-f746-4e97-a361-c5c1b376d13b',
  semanticSearch: 'e8d04e1d-7309-463b-ba7b-86dda61e3bbe',
  ragPipeline: 'd7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52',
  commandProcessor: '87780e52-abc5-4122-8225-07e74aaf18ca',
  approvalQueue: '3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01',
  clinicalDecisionSupport: 'cee8c207-bd20-42c3-aaf4-0055c1f90853',
  documentationAssistant: 'b8b85bb2-e447-4556-a314-0da1ba06afe5',
  billingCodeSuggester: '093a0c9d-44ea-4672-8208-d1d199962f33',
  auditLogging: 'fce84f6d-02b2-42dc-8ae8-5dafdc84b882'
};

// Subscriptions to create
const SUBSCRIPTIONS = [
  // Embedding Bot - triggers on clinical resources
  {
    name: 'Embedding - DiagnosticReport',
    criteria: 'DiagnosticReport',
    botId: BOTS.embedding
  },
  {
    name: 'Embedding - DocumentReference',
    criteria: 'DocumentReference',
    botId: BOTS.embedding
  },
  {
    name: 'Embedding - Observation',
    criteria: 'Observation',
    botId: BOTS.embedding
  },
  {
    name: 'Embedding - Condition',
    criteria: 'Condition',
    botId: BOTS.embedding
  },
  {
    name: 'Embedding - MedicationStatement',
    criteria: 'MedicationStatement',
    botId: BOTS.embedding
  },
  // Clinical Decision Support - triggers on encounters and medication requests
  {
    name: 'CDS - Encounter',
    criteria: 'Encounter',
    botId: BOTS.clinicalDecisionSupport
  },
  {
    name: 'CDS - MedicationRequest',
    criteria: 'MedicationRequest',
    botId: BOTS.clinicalDecisionSupport
  },
  // Billing Code Suggester - triggers on completed encounters
  {
    name: 'Billing - Encounter Finished',
    criteria: 'Encounter?status=finished',
    botId: BOTS.billingCodeSuggester
  },
  // Approval Queue - triggers on AI command tasks requiring approval
  // Matches Tasks with code system http://medplum.com/fhir/CodeSystem/ai-command
  {
    name: 'Approval Queue - Task',
    criteria: 'Task?code=http://medplum.com/fhir/CodeSystem/ai-command|',
    botId: BOTS.approvalQueue
  }
];

async function createSubscription(sub) {
  const subscription = {
    resourceType: 'Subscription',
    status: 'active',
    reason: sub.name,
    criteria: sub.criteria,
    channel: {
      type: 'rest-hook',
      endpoint: `Bot/${sub.botId}`
    }
  };

  const res = await fetch(`${API_URL}/fhir/R4/Subscription`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/fhir+json'
    },
    body: JSON.stringify(subscription)
  });

  const result = await res.json();
  console.log(`${sub.name}: ${result.id || result.issue?.[0]?.details?.text}`);
  return result;
}

async function main() {
  console.log('Creating subscriptions...\n');

  for (const sub of SUBSCRIPTIONS) {
    await createSubscription(sub);
  }

  console.log('\nDone!');
}

main().catch(console.error);
