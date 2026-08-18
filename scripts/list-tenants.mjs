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

async function listTenantsAndUsers() {
  await client.connect();
  const tenants = await client.query(`SELECT id, name, slug, status, created_at FROM public.tenants;`);
  console.log('Existing Tenants in DB:', tenants.rows);

  const users = await client.query(`SELECT id, email, created_at FROM auth.users;`);
  console.log('Existing Auth Users in DB:', users.rows);

  const memberships = await client.query(`SELECT tu.id, tu.tenant_id, tu.user_id, tu.role, t.name as tenant_name, u.email FROM public.tenant_users tu JOIN public.tenants t ON t.id = tu.tenant_id JOIN auth.users u ON u.id = tu.user_id;`);
  console.log('Tenant Memberships in DB:', memberships.rows);

  await client.end();
}

listTenantsAndUsers().catch(console.error);
