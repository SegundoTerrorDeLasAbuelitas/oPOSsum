import pg from 'pg';
import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (m) env[m[1]] = m[2]?.replace(/^['"]|['"]$/g, '').trim();
});

const hosts = [
  'aws-0-us-east-1.pooler.supabase.com:6543',
  'aws-0-us-west-1.pooler.supabase.com:6543',
  'aws-0-sa-east-1.pooler.supabase.com:6543',
  'aws-0-us-east-2.pooler.supabase.com:6543',
  'aws-0-eu-central-1.pooler.supabase.com:6543',
  `db.${env.SUPABASE_PROJECT_REF}.supabase.co:5432`
];

async function testHosts() {
  for (const h of hosts) {
    const [host, port] = h.split(':');
    const user = host.includes('pooler') ? `postgres.${env.SUPABASE_PROJECT_REF}` : 'postgres';
    const cs = `postgresql://${user}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@${host}:${port}/postgres`;
    console.log('Testing', h, '...');
    const client = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      console.log('SUCCESS:', h);
      await client.end();
      process.exit(0);
    } catch (e) {
      console.log('Failed', h, e.message);
    }
  }
  process.exit(1);
}
testHosts();
