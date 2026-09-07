import fs from 'fs';
import path from 'path';

// Read .env.local dynamically
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
const accessToken = env.SUPABASE_ACCESS_TOKEN;

if (!projectRef || !accessToken) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(1);
}

async function apply008Migration() {
  console.log(`Applying 008_create_inventory_table.sql to Supabase (${projectRef}) via Management API...`);

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/008_create_inventory_table.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to apply migration 008 (Status ${response.status}): ${errorText}`);
  }

  console.log('✅ Migration 008 applied successfully to Supabase!');
}

apply008Migration().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
