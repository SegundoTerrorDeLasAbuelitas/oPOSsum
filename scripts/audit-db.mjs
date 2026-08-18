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

async function auditDatabase() {
  await client.connect();
  console.log('--- AUDITING DATABASE TABLES & RELATIONS ---');

  // List all tables in public schema
  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Public tables:', tables.rows.map(r => r.table_name));

  // List columns of all public tables
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  console.log('Columns breakdown:', columns.rows);

  // List foreign keys
  const fks = await client.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
  `);
  console.log('Foreign keys:', fks.rows);

  // List RLS policies
  const policies = await client.query(`
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);
  console.log('RLS Policies:', policies.rows);

  await client.end();
}

auditDatabase().catch(console.error);
