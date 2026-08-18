-- =============================================================================
-- oPOSsum - Products & Presentations Schema (Multi-Tenant)
-- Migration: 002_create_products_and_groups.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PRODUCT GROUPS TABLE (Main product entity, e.g. "Nescafé")
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_groups_tenant ON public.product_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_groups_name ON public.product_groups(tenant_id, name);

-- -----------------------------------------------------------------------------
-- 2. PRODUCTS / PRESENTATIONS TABLE (Individual sellable units, e.g. "1 kg", "500 g")
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- Presentation name, e.g. "1 kg", "500 g", "Pieza"
    sku TEXT,
    barcode TEXT,
    price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cost NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_group_presentation UNIQUE (product_group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON public.products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_group ON public.products(product_group_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(tenant_id, barcode);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Product Groups Policies
DROP POLICY IF EXISTS "Users can view product groups of their tenant" ON public.product_groups;
CREATE POLICY "Users can view product groups of their tenant"
    ON public.product_groups
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert product groups in their tenant" ON public.product_groups;
CREATE POLICY "Users can insert product groups in their tenant"
    ON public.product_groups
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update product groups in their tenant" ON public.product_groups;
CREATE POLICY "Users can update product groups in their tenant"
    ON public.product_groups
    FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete product groups in their tenant" ON public.product_groups;
CREATE POLICY "Users can delete product groups in their tenant"
    ON public.product_groups
    FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Products (Presentations) Policies
DROP POLICY IF EXISTS "Users can view products of their tenant" ON public.products;
CREATE POLICY "Users can view products of their tenant"
    ON public.products
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert products in their tenant" ON public.products;
CREATE POLICY "Users can insert products in their tenant"
    ON public.products
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update products in their tenant" ON public.products;
CREATE POLICY "Users can update products in their tenant"
    ON public.products
    FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete products in their tenant" ON public.products;
CREATE POLICY "Users can delete products in their tenant"
    ON public.products
    FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 4. ATOMIC FUNCTION: CREATE PRODUCT WITH PRESENTATIONS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_presentations(
    p_tenant_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_presentations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
    v_pres JSONB;
    v_pres_name TEXT;
    v_pres_price NUMERIC;
    v_pres_cost NUMERIC;
    v_count INT := 0;
BEGIN
    -- 1. Validate Tenant Access
    IF NOT public.has_tenant_access(p_tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado al tenant especificado';
    END IF;

    -- 2. Validate Product Group Name
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    -- 3. Validate Presentations Array
    IF p_presentations IS NULL OR jsonb_array_length(p_presentations) = 0 THEN
        RAISE EXCEPTION 'Debes agregar al menos una presentación';
    END IF;

    -- 4. Insert Product Group
    INSERT INTO public.product_groups (tenant_id, name, description)
    VALUES (p_tenant_id, trim(p_name), NULLIF(trim(p_description), ''))
    RETURNING id INTO v_group_id;

    -- 5. Insert Presentations
    FOR v_pres IN SELECT * FROM jsonb_array_elements(p_presentations)
    LOOP
        v_pres_name := trim(COALESCE(v_pres->>'name', ''));
        IF length(v_pres_name) > 0 THEN
            v_pres_price := COALESCE((v_pres->>'price')::NUMERIC, 0.00);
            v_pres_cost := COALESCE((v_pres->>'cost')::NUMERIC, 0.00);

            INSERT INTO public.products (
                tenant_id,
                product_group_id,
                name,
                price,
                cost,
                status
            )
            VALUES (
                p_tenant_id,
                v_group_id,
                v_pres_name,
                v_pres_price,
                v_pres_cost,
                'active'
            )
            ON CONFLICT (product_group_id, name) DO NOTHING;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'Ninguna presentación válida fue proporcionada';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'group_id', v_group_id,
        'name', p_name,
        'presentations_count', v_count
    );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.create_product_with_presentations(UUID, TEXT, TEXT, JSONB) TO anon, authenticated;
