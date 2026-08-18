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

if (!projectRef || !password) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_DB_PASSWORD in .env.local');
  process.exit(1);
}

const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
const directConnectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

async function runMigration() {
  const migrationSqlPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_multitenant_schema.sql');
  const sql = fs.readFileSync(migrationSqlPath, 'utf8');

  console.log(`Connecting to Supabase PostgreSQL database (${projectRef})...`);
  
  let client;
  try {
    // Try direct connection first
    client = new Client({
      connectionString: directConnectionString,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    console.log('Connected via direct host!');
  } catch (err) {
    console.log('Direct connection failed, trying pooler connection...');
    try {
      client = new Client({
        connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();
      console.log('Connected via pooler us-east-1!');
    } catch (err2) {
      console.log('Trying pooler us-west-1...');
      client = new Client({
        connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();
      console.log('Connected via pooler us-west-1!');
    }
  }

  console.log('Applying 001_initial_multitenant_schema.sql...');
  await client.query(sql);
  console.log('✅ Migration applied successfully!');

  // Verify created tables
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Public tables in database:', res.rows.map(r => r.table_name));

  await client.end();
}

runMigration().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
