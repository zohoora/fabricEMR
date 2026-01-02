const API_URL = 'http://localhost:8103';

const BOTS = {
  'd089f714-f746-4e97-a361-c5c1b376d13b': 'Embedding Bot',
  'e8d04e1d-7309-463b-ba7b-86dda61e3bbe': 'Semantic Search Bot',
  'd7f9a8c7-5da6-49a2-9a8e-7ebfb3987f52': 'RAG Pipeline Bot',
  '87780e52-abc5-4122-8225-07e74aaf18ca': 'Command Processor Bot',
  '3ffa69a6-5bcf-4c3d-b1ea-225add4c0b01': 'Approval Queue Bot',
  'cee8c207-bd20-42c3-aaf4-0055c1f90853': 'Clinical Decision Support Bot',
  'b8b85bb2-e447-4556-a314-0da1ba06afe5': 'Documentation Assistant Bot',
  '093a0c9d-44ea-4672-8208-d1d199962f33': 'Billing Code Suggester Bot',
  'fce84f6d-02b2-42dc-8ae8-5dafdc84b882': 'Audit Logging Bot'
};

async function getToken() {
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'medplum',
      scope: 'openid',
      codeChallenge: 'verify123',
      codeChallengeMethod: 'plain'
    })
  });
  const login = await loginRes.json();

  const tokenRes = await fetch(`${API_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${login.code}&code_verifier=verify123`
  });
  const token = await tokenRes.json();
  return token.access_token;
}

async function main() {
  const token = await getToken();

  console.log('=== DEPLOYED BOTS ===\n');

  for (const [id, name] of Object.entries(BOTS)) {
    const res = await fetch(`${API_URL}/fhir/R4/Bot/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const bot = await res.json();

    const hasCode = bot.executableCode?.url ? '✓' : '✗';
    console.log(`${hasCode} ${name}`);
    console.log(`  ID: ${id}`);
    console.log(`  Code: ${bot.executableCode?.title || 'None'}`);
    console.log('');
  }

  console.log('=== SUBSCRIPTIONS ===\n');

  const subsRes = await fetch(`${API_URL}/fhir/R4/Subscription`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const subs = await subsRes.json();

  if (subs.entry) {
    for (const entry of subs.entry) {
      const sub = entry.resource;
      console.log(`✓ ${sub.reason}`);
      console.log(`  Criteria: ${sub.criteria}`);
      console.log(`  Endpoint: ${sub.channel?.endpoint}`);
      console.log('');
    }
  } else {
    console.log('No subscriptions found');
  }

  console.log('=== DEPLOYMENT COMPLETE ===');
}

main().catch(console.error);
