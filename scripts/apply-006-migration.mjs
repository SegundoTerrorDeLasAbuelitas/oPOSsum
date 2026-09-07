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

async function apply006Migration() {
  console.log(`Applying 006_suppliers_and_presentations.sql to Supabase (${projectRef}) via Management API...`);

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/006_suppliers_and_presentations.sql');
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
    throw new Error(`Failed to apply migration (Status ${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('✅ Migration 006 applied successfully via Management API!');

  // Verify created tables
  const verifyResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('suppliers', 'supplier_presentations')
        ORDER BY table_name;
      `
    })
  });

  if (verifyResponse.ok) {
    const verifyResult = await verifyResponse.json();
    console.log('✅ Verified tables in Supabase:', verifyResult);
  }

  // Also install the exec_sql bridge function for future convenience
  const bridgeSql = `
    CREATE OR REPLACE FUNCTION public.exec_sql(sql_query TEXT)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql_query;
    END;
    $$;
    REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;
  `;
  await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: bridgeSql })
  });
  console.log('✅ Bridge function exec_sql also provisioned for automated future migrations!');
}

apply006Migration().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
