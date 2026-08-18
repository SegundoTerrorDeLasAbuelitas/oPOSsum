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

async function checkUsers() {
  await client.connect();
  const res = await client.query(`SELECT id, email, created_at, email_confirmed_at, raw_user_meta_data FROM auth.users ORDER BY created_at DESC LIMIT 5;`);
  console.log('Auth users in database:', res.rows);

  // Check auth config / email confirmation settings
  const configRes = await client.query(`SELECT * FROM auth.instances;`).catch(e => ({ rows: [] }));
  console.log('Auth instances:', configRes.rows);

  await client.end();
}

checkUsers().catch(console.error);
