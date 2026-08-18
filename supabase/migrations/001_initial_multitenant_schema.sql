-- =============================================================================
-- oPOSsum - Multi-Tenant Architecture & Security Schema
-- Migration: 001_initial_multitenant_schema.sql
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. TENANTS TABLE (Business / Instance definition)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for slug lookups
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants(slug);

-- -----------------------------------------------------------------------------
-- 2. USER PROFILES (Extensions to auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    last_active_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. TENANT USERS (User-to-Tenant relationship & roles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'manager', 'cashier')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON public.tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON public.tenant_users(tenant_id);

-- -----------------------------------------------------------------------------
-- 4. SYSTEM SETTINGS (Global / General Configurations)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. TENANT SETTINGS (Tenant-Specific Overrides)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_setting_key UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_lookup ON public.tenant_settings(tenant_id, key);

-- -----------------------------------------------------------------------------
-- 6. HELPER FUNCTIONS & RLS CORE
-- -----------------------------------------------------------------------------

-- Helper: Get all tenant IDs accessible by the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT tu.tenant_id
    FROM public.tenant_users tu
    WHERE tu.user_id = auth.uid()
      AND tu.is_active = true;
$$;

-- Helper: Check if current user has access to a specific tenant
CREATE OR REPLACE FUNCTION public.has_tenant_access(target_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_users tu
        WHERE tu.user_id = auth.uid()
          AND tu.tenant_id = target_tenant_id
          AND tu.is_active = true
    );
$$;

-- Helper: Check if current user has admin/owner role in a specific tenant
CREATE OR REPLACE FUNCTION public.is_tenant_admin(target_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_users tu
        WHERE tu.user_id = auth.uid()
          AND tu.tenant_id = target_tenant_id
          AND tu.role IN ('owner', 'admin')
          AND tu.is_active = true
    );
$$;

-- Hierarchy Resolution Function: Global Default + Tenant Override
CREATE OR REPLACE FUNCTION public.get_effective_setting(p_tenant_id UUID, p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_tenant_val JSONB;
    v_global_val JSONB;
BEGIN
    -- 1. Check if caller has access to the requested tenant
    IF NOT public.has_tenant_access(p_tenant_id) THEN
        RAISE EXCEPTION 'Access denied to tenant settings';
    END IF;

    -- 2. Look for tenant-specific override
    SELECT value INTO v_tenant_val
    FROM public.tenant_settings
    WHERE tenant_id = p_tenant_id AND key = p_key;

    IF v_tenant_val IS NOT NULL THEN
        RETURN v_tenant_val;
    END IF;

    -- 3. Fallback to global system setting
    SELECT value INTO v_global_val
    FROM public.system_settings
    WHERE key = p_key;

    RETURN v_global_val;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. ATOMIC TENANT ONBOARDING FUNCTION
-- -----------------------------------------------------------------------------
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
    v_clean_slug TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to create a tenant';
    END IF;

    -- Normalize slug
    v_clean_slug := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9\-]', '-', 'g'));
    IF length(v_clean_slug) < 3 THEN
        RAISE EXCEPTION 'Slug must have at least 3 alphanumeric characters';
    END IF;

    -- Check slug availability
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_clean_slug) THEN
        RAISE EXCEPTION 'Tenant slug already exists';
    END IF;

    -- 1. Insert Tenant
    INSERT INTO public.tenants (name, slug, status)
    VALUES (trim(p_name), v_clean_slug, 'active')
    RETURNING id INTO v_tenant_id;

    -- 2. Insert User as Owner
    INSERT INTO public.tenant_users (tenant_id, user_id, role, is_active)
    VALUES (v_tenant_id, v_user_id, 'owner', true);

    -- 3. Update User Profile last active tenant
    INSERT INTO public.user_profiles (id, email, last_active_tenant_id)
    VALUES (v_user_id, auth.jwt()->>'email', v_tenant_id)
    ON CONFLICT (id) DO UPDATE
    SET last_active_tenant_id = v_tenant_id,
        updated_at = now();

    RETURN jsonb_build_object(
        'success', true,
        'tenant_id', v_tenant_id,
        'name', p_name,
        'slug', v_clean_slug,
        'role', 'owner'
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

-- ---- TENANTS POLICIES ----
DROP POLICY IF EXISTS "Users can view their accessible tenants" ON public.tenants;
CREATE POLICY "Users can view their accessible tenants"
    ON public.tenants
    FOR SELECT
    USING (id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Admins can update their tenant" ON public.tenants;
CREATE POLICY "Admins can update their tenant"
    ON public.tenants
    FOR UPDATE
    USING (public.is_tenant_admin(id))
    WITH CHECK (public.is_tenant_admin(id));

-- ---- USER PROFILES POLICIES ----
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile"
    ON public.user_profiles
    FOR SELECT
    USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
    ON public.user_profiles
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ---- TENANT USERS POLICIES ----
DROP POLICY IF EXISTS "Users can view members of their tenants" ON public.tenant_users;
CREATE POLICY "Users can view members of their tenants"
    ON public.tenant_users
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Admins can manage tenant users" ON public.tenant_users;
CREATE POLICY "Admins can manage tenant users"
    ON public.tenant_users
    FOR ALL
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- ---- SYSTEM SETTINGS POLICIES ----
DROP POLICY IF EXISTS "Authenticated users can read global settings" ON public.system_settings;
CREATE POLICY "Authenticated users can read global settings"
    ON public.system_settings
    FOR SELECT
    TO authenticated
    USING (true);

-- ---- TENANT SETTINGS POLICIES ----
DROP POLICY IF EXISTS "Users can view settings of their tenant" ON public.tenant_settings;
CREATE POLICY "Users can view settings of their tenant"
    ON public.tenant_settings
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Admins can modify settings of their tenant" ON public.tenant_settings;
CREATE POLICY "Admins can modify settings of their tenant"
    ON public.tenant_settings
    FOR ALL
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- -----------------------------------------------------------------------------
-- 9. DEFAULT SYSTEM SETTINGS SEED
-- -----------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value, description)
VALUES 
    ('app_name', '"oPOSsum"', 'Nombre base de la aplicación'),
    ('theme_primary_color', '"#00A4AE"', 'Color primario de la interfaz'),
    ('currency', '"MXN"', 'Moneda predeterminada'),
    ('allow_discounts', 'true', 'Permitir descuentos en punto de venta')
ON CONFLICT (key) DO NOTHING;
