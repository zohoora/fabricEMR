const fs = require('fs');
const path = require('path');

// Read token from file (created by auth flow) or environment
let ACCESS_TOKEN;
try {
  const tokenData = fs.readFileSync('/tmp/token.json', 'utf8');
  ACCESS_TOKEN = JSON.parse(tokenData).access_token;
} catch (e) {
  ACCESS_TOKEN = process.env.MEDPLUM_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    console.error('Error: No access token found.');
    console.error('Either run the auth flow to create /tmp/token.json or set MEDPLUM_ACCESS_TOKEN env var.');
    console.error('\nTo get a token, run:');
    console.error('  curl -X POST http://localhost:8103/auth/login -H "Content-Type: application/json" \\');
    console.error('    -d \'{"email":"admin@example.com","password":"medplum","scope":"openid","codeChallenge":"test","codeChallengeMethod":"plain"}\'');
    console.error('  # Then exchange the code for a token');
    process.exit(1);
  }
}
const API_URL = process.env.MEDPLUM_API_URL || 'http://localhost:8103';
const DIST_DIR = path.join(__dirname, 'bots', 'dist');

const BOTS = [
  { id: 'd089f714-f746-4e97-a361-c5c1b376d13b', file: 'embedding-bot.js', name: 'Embedding Bot' },
  { id: 'e8d04e1d-7309-463b-ba7b-86dda61e3bbe', file: 'semantic-search-bot.js', name: 'Semantic Search Bot' },
  { id: 'd7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52', file: 'rag-pipeline-bot.js', name: 'RAG Pipeline Bot' },
  { id: '87780e52-abc5-4122-8225-07e74aaf18ca', file: 'command-processor-bot.js', name: 'Command Processor Bot' },
  { id: '3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01', file: 'approval-queue-bot.js', name: 'Approval Queue Bot' },
  { id: 'cee8c207-bd20-42c3-aaf4-0055c1f90853', file: 'clinical-decision-support-bot.js', name: 'Clinical Decision Support Bot' },
  { id: 'b8b85bb2-e447-4556-a314-0da1ba06afe5', file: 'documentation-assistant-bot.js', name: 'Documentation Assistant Bot' },
  { id: '093a0c9d-44ea-4672-8208-d1d199962f33', file: 'billing-code-suggester-bot.js', name: 'Billing Code Suggester Bot' },
  { id: 'fce84f6d-02b2-42dc-8ae8-5dafdc84b882', file: 'audit-logging-bot.js', name: 'Audit Logging Bot' }
];

async function deployBot(bot) {
  const code = fs.readFileSync(path.join(DIST_DIR, bot.file));

  // Create Binary
  const binaryRes = await fetch(`${API_URL}/fhir/R4/Binary`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/javascript'
    },
    body: code
  });
  const binary = await binaryRes.json();

  if (!binary.id) {
    console.log(`Failed to create Binary for ${bot.name}:`, binary);
    return;
  }

  // Update Bot
  const botRes = await fetch(`${API_URL}/fhir/R4/Bot/${bot.id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/fhir+json'
    },
    body: JSON.stringify({
      resourceType: 'Bot',
      id: bot.id,
      name: bot.name,
      description: `${bot.name} for FabricEMR`,
      runtimeVersion: 'vmcontext',
      sourceCode: { url: `Binary/${binary.id}`, title: bot.file },
      executableCode: { url: `Binary/${binary.id}`, title: bot.file }
    })
  });
  const result = await botRes.json();
  console.log(`Deployed ${bot.name}: ${result.name || result.issue?.[0]?.details?.text}`);
}

async function main() {
  for (const bot of BOTS) {
    await deployBot(bot);
  }
  console.log('All bots deployed!');
}

main().catch(console.error);
