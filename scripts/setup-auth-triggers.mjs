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

async function applyAuthTrigger() {
  await client.connect();
  console.log('Connecting to database to setup auto-confirm trigger...');

  const sql = `
    -- Function to auto-confirm user and create profile
    CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      -- Auto-confirm email so free-tier rate limits or unverified emails never block onboarding
      NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS tr_auto_confirm_user ON auth.users;
    CREATE TRIGGER tr_auto_confirm_user
      BEFORE INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

    -- Also create profile trigger after insert
    CREATE OR REPLACE FUNCTION public.handle_user_profile_creation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      INSERT INTO public.user_profiles (id, email, full_name)
      VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
      ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name);
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS tr_create_user_profile ON auth.users;
    CREATE TRIGGER tr_create_user_profile
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_user_profile_creation();
  `;

  await client.query(sql);
  console.log('✅ Auth triggers installed successfully!');
  await client.end();
}

applyAuthTrigger().catch(console.error);
