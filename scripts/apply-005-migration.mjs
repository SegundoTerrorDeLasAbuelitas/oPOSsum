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

async function apply005Migration() {
  await client.connect();
  console.log('Applying 005_nullable_sale_items_fk.sql to Supabase...');

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/005_nullable_sale_items_fk.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await client.query(sql);
  console.log('✅ Migration 005 applied successfully!');

  await client.end();
}

apply005Migration().catch(console.error);
