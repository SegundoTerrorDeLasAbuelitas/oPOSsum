import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Client } = pg;

// Read .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val.trim();
  }
});

const projectRef = env.SUPABASE_PROJECT_REF;
const password = env.SUPABASE_DB_PASSWORD;

async function apply006Migration() {
  console.log(`Applying 006_suppliers_and_presentations.sql to Supabase (${projectRef})...`);

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/006_suppliers_and_presentations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  let client;
  try {
    client = new Client({
      connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    console.log('Connected via pooler us-east-1!');
  } catch (err) {
    console.log('Pooler us-east-1 failed, trying pooler us-west-1...', err.message);
    client = new Client({
      connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    console.log('Connected via pooler us-west-1!');
  }

  await client.query(sql);
  console.log('✅ Migration 006 applied successfully!');

  // Verify created tables
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('suppliers', 'supplier_presentations')
    ORDER BY table_name;
  `);
  console.log('Verified tables:', res.rows.map(r => r.table_name));

  await client.end();
}

apply006Migration().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
