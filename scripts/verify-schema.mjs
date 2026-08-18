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

async function verify() {
  await client.connect();
  console.log('--- VERIFYING MULTI-TENANT DATABASE STATE ---');

  // Check RLS status on tables
  const rlsRes = await client.query(`
    SELECT relname as table_name, relrowsecurity as rls_enabled
    FROM pg_class
    WHERE relname IN ('tenants', 'tenant_users', 'user_profiles', 'system_settings', 'tenant_settings')
      AND relnamespace = 'public'::regnamespace;
  `);
  console.log('RLS Status:', rlsRes.rows);

  // Check policies
  const polRes = await client.query(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);
  console.log('Policies configured:', polRes.rows);

  // Check system settings default seed
  const settingsRes = await client.query(`SELECT key, value, description FROM public.system_settings;`);
  console.log('Default Global Settings seeded:', settingsRes.rows);

  await client.end();
}

verify().catch(console.error);
