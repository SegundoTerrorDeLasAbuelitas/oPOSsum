import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Client } = pg;

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

const client = new Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@db.${env.SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false }
});

async function apply003Migration() {
  await client.connect();
  console.log('Applying 003_add_categories_and_pricing.sql to Supabase database...');

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/003_add_categories_and_pricing.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await client.query(sql);
  console.log('✅ Migration 003 applied successfully!');

  // Verify created tables
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Current Public Tables:', res.rows.map(r => r.table_name));

  await client.end();
}

apply003Migration().catch(console.error);
