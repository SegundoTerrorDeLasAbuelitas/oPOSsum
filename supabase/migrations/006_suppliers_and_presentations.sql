-- =============================================================================
-- oPOSsum - Suppliers & Many-to-Many Presentations Schema (Multi-Tenant)
-- Migration: 006_suppliers_and_presentations.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SUPPLIERS TABLE
-- None of the contact/name fields are mandatory (can be saved completely empty)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON public.suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(tenant_id, name);

-- RLS on suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view suppliers of their tenant" ON public.suppliers;
CREATE POLICY "Users can view suppliers of their tenant"
    ON public.suppliers FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert suppliers in their tenant" ON public.suppliers;
CREATE POLICY "Users can insert suppliers in their tenant"
    ON public.suppliers FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update suppliers in their tenant" ON public.suppliers;
CREATE POLICY "Users can update suppliers in their tenant"
    ON public.suppliers FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete suppliers in their tenant" ON public.suppliers;
CREATE POLICY "Users can delete suppliers in their tenant"
    ON public.suppliers FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 2. SUPPLIER_PRESENTATIONS TABLE (Many-to-Many Junction)
-- One supplier can supply multiple presentations; one presentation can have multiple suppliers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_presentations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    last_purchase_cost NUMERIC(12,2) DEFAULT 0.00,
    supplier_sku TEXT DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_product UNIQUE (supplier_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supp_pres_tenant ON public.supplier_presentations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supp_pres_supplier ON public.supplier_presentations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supp_pres_product ON public.supplier_presentations(product_id);

-- RLS on supplier_presentations
ALTER TABLE public.supplier_presentations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view supplier_presentations of their tenant" ON public.supplier_presentations;
CREATE POLICY "Users can view supplier_presentations of their tenant"
    ON public.supplier_presentations FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert supplier_presentations in their tenant" ON public.supplier_presentations;
CREATE POLICY "Users can insert supplier_presentations in their tenant"
    ON public.supplier_presentations FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update supplier_presentations in their tenant" ON public.supplier_presentations;
CREATE POLICY "Users can update supplier_presentations in their tenant"
    ON public.supplier_presentations FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete supplier_presentations in their tenant" ON public.supplier_presentations;
CREATE POLICY "Users can delete supplier_presentations in their tenant"
    ON public.supplier_presentations FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 3. ATOMIC FUNCTION: CREATE PRODUCT WITH PRESENTATIONS AND SUPPLIERS
-- Requires at least one supplier per presentation
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_product_with_presentations(UUID, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_product_with_presentations(
    p_tenant_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_presentations JSONB,
    p_category_id UUID DEFAULT NULL
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
    v_product_id UUID;
    v_supplier_id UUID;
    v_supplier_item JSONB;
    v_has_supplier BOOLEAN;
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

    -- 3. Validate Category (if provided, must belong to tenant)
    IF p_category_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'La categoría seleccionada no pertenece a tu negocio';
        END IF;
    END IF;

    -- 4. Validate Presentations Array
    IF p_presentations IS NULL OR jsonb_array_length(p_presentations) = 0 THEN
        RAISE EXCEPTION 'Debes agregar al menos una presentación';
    END IF;

    -- 5. Validate that every presentation has at least one valid supplier
    FOR v_pres IN SELECT * FROM jsonb_array_elements(p_presentations)
    LOOP
        v_pres_name := trim(COALESCE(v_pres->>'name', ''));
        IF length(v_pres_name) > 0 THEN
            v_has_supplier := false;
            
            -- Can be passed as single "supplier_id" or array "supplier_ids"
            IF v_pres->>'supplier_id' IS NOT NULL AND length(trim(v_pres->>'supplier_id')) > 0 THEN
                v_has_supplier := true;
            ELSIF v_pres->'supplier_ids' IS NOT NULL AND jsonb_array_length(v_pres->'supplier_ids') > 0 THEN
                v_has_supplier := true;
            END IF;

            IF NOT v_has_supplier THEN
                RAISE EXCEPTION 'Selecciona al menos un proveedor para la presentación "%"', v_pres_name;
            END IF;
        END IF;
    END LOOP;

    -- 6. Insert Product Group
    INSERT INTO public.product_groups (tenant_id, category_id, name, description)
    VALUES (p_tenant_id, p_category_id, trim(p_name), NULLIF(trim(p_description), ''))
    RETURNING id INTO v_group_id;

    -- 7. Insert Presentations & Supplier Relationships
    FOR v_pres IN SELECT * FROM jsonb_array_elements(p_presentations)
    LOOP
        v_pres_name := trim(COALESCE(v_pres->>'name', ''));
        IF length(v_pres_name) > 0 THEN
            v_pres_price := COALESCE((v_pres->>'price')::NUMERIC, 0.00);
            v_pres_cost := COALESCE((v_pres->>'cost')::NUMERIC, 0.00);

            IF v_pres_price < 0 THEN
                RAISE EXCEPTION 'El precio no puede ser negativo';
            END IF;

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
            ON CONFLICT (product_group_id, name) DO NOTHING
            RETURNING id INTO v_product_id;

            -- In case it already existed and on conflict did nothing
            IF v_product_id IS NULL THEN
                SELECT id INTO v_product_id 
                FROM public.products 
                WHERE product_group_id = v_group_id AND name = v_pres_name;
            END IF;

            -- Associate single supplier_id if passed
            IF v_pres->>'supplier_id' IS NOT NULL AND length(trim(v_pres->>'supplier_id')) > 0 THEN
                v_supplier_id := (v_pres->>'supplier_id')::UUID;
                -- Verify supplier belongs to same tenant
                IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = p_tenant_id) THEN
                    INSERT INTO public.supplier_presentations (tenant_id, supplier_id, product_id, is_primary)
                    VALUES (p_tenant_id, v_supplier_id, v_product_id, true)
                    ON CONFLICT (supplier_id, product_id) DO NOTHING;
                END IF;
            END IF;

            -- Associate multiple supplier_ids if passed
            IF v_pres->'supplier_ids' IS NOT NULL AND jsonb_array_length(v_pres->'supplier_ids') > 0 THEN
                FOR v_supplier_item IN SELECT * FROM jsonb_array_elements(v_pres->'supplier_ids')
                LOOP
                    v_supplier_id := trim(v_supplier_item::text, '"')::UUID;
                    IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = p_tenant_id) THEN
                        INSERT INTO public.supplier_presentations (tenant_id, supplier_id, product_id, is_primary)
                        VALUES (p_tenant_id, v_supplier_id, v_product_id, false)
                        ON CONFLICT (supplier_id, product_id) DO NOTHING;
                    END IF;
                END LOOP;
            END IF;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'Ninguna presentación válida fue proporcionada';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'group_id', v_group_id,
        'category_id', p_category_id,
        'name', p_name,
        'presentations_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_presentations(UUID, TEXT, TEXT, JSONB, UUID) TO anon, authenticated;
