-- =============================================================================
-- oPOSsum - Categories, Pricing & Sales Infrastructure (Multi-Tenant)
-- Migration: 003_add_categories_and_pricing.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CATEGORIES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_category UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON public.categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_name ON public.categories(tenant_id, name);

-- RLS on categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view categories of their tenant" ON public.categories;
CREATE POLICY "Users can view categories of their tenant"
    ON public.categories FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert categories in their tenant" ON public.categories;
CREATE POLICY "Users can insert categories in their tenant"
    ON public.categories FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update categories in their tenant" ON public.categories;
CREATE POLICY "Users can update categories in their tenant"
    ON public.categories FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete categories in their tenant" ON public.categories;
CREATE POLICY "Users can delete categories in their tenant"
    ON public.categories FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 2. LINK PRODUCT GROUPS TO CATEGORIES
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'product_groups' 
          AND column_name = 'category_id'
    ) THEN
        ALTER TABLE public.product_groups 
        ADD COLUMN category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;
        
        CREATE INDEX IF NOT EXISTS idx_product_groups_category ON public.product_groups(category_id);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. SALES & SALE ITEMS (Infrastructure ready for current & future checkouts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    customer_name TEXT NOT NULL DEFAULT 'Cliente Mostrador',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant ON public.sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON public.sales(tenant_id, created_at DESC);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sales of their tenant" ON public.sales;
CREATE POLICY "Users can view sales of their tenant"
    ON public.sales FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert sales in their tenant" ON public.sales;
CREATE POLICY "Users can insert sales in their tenant"
    ON public.sales FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sale items of their tenant" ON public.sale_items;
CREATE POLICY "Users can view sale items of their tenant"
    ON public.sale_items FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert sale items in their tenant" ON public.sale_items;
CREATE POLICY "Users can insert sale items in their tenant"
    ON public.sale_items FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 4. ATOMIC FUNCTION: CREATE PRODUCT WITH CATEGORY & PRICED PRESENTATIONS
-- -----------------------------------------------------------------------------
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

    -- 5. Insert Product Group
    INSERT INTO public.product_groups (tenant_id, category_id, name, description)
    VALUES (p_tenant_id, p_category_id, trim(p_name), NULLIF(trim(p_description), ''))
    RETURNING id INTO v_group_id;

    -- 6. Insert Presentations with Price Validation
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
        'category_id', p_category_id,
        'name', p_name,
        'presentations_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_presentations(UUID, TEXT, TEXT, JSONB, UUID) TO anon, authenticated;
