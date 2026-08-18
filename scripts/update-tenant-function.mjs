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

async function updateTenantFunction() {
  await client.connect();
  console.log('Updating create_tenant_with_owner function with smart unique slug generation...');

  const sql = `
    CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
        p_name TEXT,
        p_slug TEXT
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
        v_user_id UUID;
        v_tenant_id UUID;
        v_base_slug TEXT;
        v_final_slug TEXT;
        v_counter INT := 1;
    BEGIN
        v_user_id := auth.uid();
        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'User must be authenticated to create a tenant';
        END IF;

        -- Clean base slug
        v_base_slug := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9\-]', '-', 'g'));
        IF length(v_base_slug) < 3 THEN
            v_base_slug := 'negocio-' || substr(md5(random()::text), 1, 6);
        END IF;

        v_final_slug := v_base_slug;

        -- If slug already exists, automatically append counter until unique
        WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_final_slug) LOOP
            v_counter := v_counter + 1;
            v_final_slug := v_base_slug || '-' || v_counter;
        END LOOP;

        -- 1. Insert Tenant
        INSERT INTO public.tenants (name, slug, status)
        VALUES (trim(p_name), v_final_slug, 'active')
        RETURNING id INTO v_tenant_id;

        -- 2. Insert User as Owner
        INSERT INTO public.tenant_users (tenant_id, user_id, role, is_active)
        VALUES (v_tenant_id, v_user_id, 'owner', true);

        -- 3. Update User Profile last active tenant
        INSERT INTO public.user_profiles (id, email, last_active_tenant_id)
        VALUES (v_user_id, COALESCE(auth.jwt()->>'email', 'usuario@opossum.app'), v_tenant_id)
        ON CONFLICT (id) DO UPDATE
        SET last_active_tenant_id = v_tenant_id,
            updated_at = now();

        RETURN jsonb_build_object(
            'success', true,
            'tenant_id', v_tenant_id,
            'name', p_name,
            'slug', v_final_slug,
            'role', 'owner'
        );
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner TO anon, authenticated;
  `;

  await client.query(sql);
  console.log('✅ Function updated successfully!');
  await client.end();
}

updateTenantFunction().catch(console.error);
