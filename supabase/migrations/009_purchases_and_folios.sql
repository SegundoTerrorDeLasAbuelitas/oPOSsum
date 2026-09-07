-- =============================================================================
-- oPOSsum - Purchases & Concurrency-Safe Sequential Folios
-- Migration: 009_purchases_and_folios.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PURCHASES TABLE (HEADER)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    folio TEXT NOT NULL,
    folio_number INT NOT NULL,
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference TEXT,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_purchase_folio UNIQUE (tenant_id, folio)
);

CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON public.purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_folio ON public.purchases(tenant_id, folio_number DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.purchases(tenant_id, purchase_date DESC);

-- -----------------------------------------------------------------------------
-- 2. PURCHASE ITEMS TABLE (LINE ITEMS WITH HISTORICAL SNAPSHOT)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    presentation_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    presentation_name TEXT NOT NULL,
    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant ON public.purchase_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_presentation ON public.purchase_items(presentation_id);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

-- Purchases Policies
DROP POLICY IF EXISTS "Users can view purchases of their tenant" ON public.purchases;
CREATE POLICY "Users can view purchases of their tenant"
    ON public.purchases
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert purchases in their tenant" ON public.purchases;
CREATE POLICY "Users can insert purchases in their tenant"
    ON public.purchases
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update purchases in their tenant" ON public.purchases;
CREATE POLICY "Users can update purchases in their tenant"
    ON public.purchases
    FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete purchases in their tenant" ON public.purchases;
CREATE POLICY "Users can delete purchases in their tenant"
    ON public.purchases
    FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Purchase Items Policies
DROP POLICY IF EXISTS "Users can view purchase items of their tenant" ON public.purchase_items;
CREATE POLICY "Users can view purchase items of their tenant"
    ON public.purchase_items
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert purchase items in their tenant" ON public.purchase_items;
CREATE POLICY "Users can insert purchase items in their tenant"
    ON public.purchase_items
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can update purchase items in their tenant" ON public.purchase_items;
CREATE POLICY "Users can update purchase items in their tenant"
    ON public.purchase_items
    FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can delete purchase items in their tenant" ON public.purchase_items;
CREATE POLICY "Users can delete purchase items in their tenant"
    ON public.purchase_items
    FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 4. ATOMIC FUNCTION: CREATE PURCHASE ORDER WITH INVENTORY ENTRY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
    p_tenant_id UUID,
    p_supplier_id UUID,
    p_purchase_date DATE,
    p_reference TEXT,
    p_notes TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next_folio_num INT;
    v_folio_str TEXT;
    v_purchase_id UUID;
    v_supplier_name TEXT;
    v_item JSONB;
    v_pres_id UUID;
    v_prod_name TEXT;
    v_pres_name TEXT;
    v_qty NUMERIC(12,2);
    v_unit_cost NUMERIC(12,2);
    v_item_subtotal NUMERIC(12,2);
    v_total_subtotal NUMERIC(12,2) := 0.00;
    v_created_at TIMESTAMPTZ := now();
    v_items_count INT := 0;
    v_prev_inv_qty NUMERIC(12,2) := 0.00;
    v_new_inv_qty NUMERIC(12,2) := 0.00;
BEGIN
    -- 1. Validate Tenant Access
    IF auth.role() <> 'service_role' AND NOT public.has_tenant_access(p_tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado al negocio especificado';
    END IF;

    -- 2. Validate Items array
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La orden de compra no contiene productos';
    END IF;

    -- 3. Resolve Supplier Name Snapshot
    IF p_supplier_id IS NOT NULL THEN
        SELECT name INTO v_supplier_name
        FROM public.suppliers
        WHERE id = p_supplier_id AND tenant_id = p_tenant_id;

        IF v_supplier_name IS NULL OR trim(v_supplier_name) = '' THEN
            v_supplier_name := 'Proveedor sin nombre';
        END IF;
    ELSE
        v_supplier_name := 'Proveedor sin registrar';
    END IF;

    -- 4. Concurrency-Safe Next Folio Calculation per Tenant
    SELECT COALESCE(MAX(folio_number), 0) + 1 
    INTO v_next_folio_num
    FROM public.purchases
    WHERE tenant_id = p_tenant_id;

    v_folio_str := 'C-' || lpad(v_next_folio_num::text, 6, '0');

    -- 5. Calculate Subtotal and Validate Products
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pres_id := (v_item->>'presentation_id')::UUID;
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
        v_unit_cost := COALESCE((v_item->>'unit_cost')::NUMERIC, 0.00);

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a 0';
        END IF;

        IF v_unit_cost < 0 THEN
            RAISE EXCEPTION 'El costo unitario no puede ser negativo';
        END IF;

        -- Verify presentation exists in tenant
        IF NOT EXISTS (
            SELECT 1 FROM public.products 
            WHERE id = v_pres_id AND tenant_id = p_tenant_id
        ) THEN
            RAISE EXCEPTION 'La presentación seleccionada no existe o no pertenece a este negocio';
        END IF;

        v_item_subtotal := round(v_qty * v_unit_cost, 2);
        v_total_subtotal := v_total_subtotal + v_item_subtotal;
        v_items_count := v_items_count + 1;
    END LOOP;

    IF v_items_count = 0 THEN
        RAISE EXCEPTION 'No se proporcionaron artículos válidos para la compra';
    END IF;

    -- 6. Insert Purchase Header
    INSERT INTO public.purchases (
        tenant_id,
        user_id,
        supplier_id,
        supplier_name,
        folio,
        folio_number,
        purchase_date,
        reference,
        subtotal,
        total,
        status,
        notes,
        created_at,
        updated_at
    )
    VALUES (
        p_tenant_id,
        auth.uid(),
        p_supplier_id,
        v_supplier_name,
        v_folio_str,
        v_next_folio_num,
        COALESCE(p_purchase_date, CURRENT_DATE),
        NULLIF(trim(p_reference), ''),
        v_total_subtotal,
        v_total_subtotal,
        'completed',
        NULLIF(trim(p_notes), ''),
        v_created_at,
        v_created_at
    )
    RETURNING id INTO v_purchase_id;

    -- 7. Insert Purchase Items, Update Supplier Cost & Increment Inventory
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pres_id := (v_item->>'presentation_id')::UUID;
        v_prod_name := trim(COALESCE(v_item->>'product_name', 'Producto'));
        v_pres_name := trim(COALESCE(v_item->>'presentation_name', 'Estándar'));
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
        v_unit_cost := COALESCE((v_item->>'unit_cost')::NUMERIC, 0.00);
        v_item_subtotal := round(v_qty * v_unit_cost, 2);

        -- 7a. Insert Line Item Snapshot
        INSERT INTO public.purchase_items (
            tenant_id,
            purchase_id,
            presentation_id,
            product_name,
            presentation_name,
            quantity,
            unit_cost,
            subtotal,
            created_at
        )
        VALUES (
            p_tenant_id,
            v_purchase_id,
            v_pres_id,
            v_prod_name,
            v_pres_name,
            v_qty,
            v_unit_cost,
            v_item_subtotal,
            v_created_at
        );

        -- 7b. Update / Upsert last_purchase_cost for this supplier relationship if supplier is specified
        IF p_supplier_id IS NOT NULL THEN
            INSERT INTO public.supplier_presentations (
                tenant_id,
                supplier_id,
                product_id,
                last_purchase_cost,
                updated_at
            )
            VALUES (
                p_tenant_id,
                p_supplier_id,
                v_pres_id,
                v_unit_cost,
                v_created_at
            )
            ON CONFLICT (supplier_id, product_id)
            DO UPDATE SET
                last_purchase_cost = EXCLUDED.last_purchase_cost,
                updated_at = EXCLUDED.updated_at;
        END IF;

        -- 7c. Retrieve Previous Inventory Quantity with row lock if exists
        SELECT quantity INTO v_prev_inv_qty
        FROM public.inventory
        WHERE tenant_id = p_tenant_id AND presentation_id = v_pres_id
        FOR UPDATE;

        IF v_prev_inv_qty IS NULL THEN
            v_prev_inv_qty := 0.00;
        END IF;

        v_new_inv_qty := v_prev_inv_qty + v_qty;

        -- 7d. Upsert Inventory Stock (Atomic additive upsert)
        INSERT INTO public.inventory (
            tenant_id,
            presentation_id,
            quantity,
            updated_at
        )
        VALUES (
            p_tenant_id,
            v_pres_id,
            v_qty,
            v_created_at
        )
        ON CONFLICT (tenant_id, presentation_id)
        DO UPDATE SET
            quantity = public.inventory.quantity + EXCLUDED.quantity,
            updated_at = EXCLUDED.updated_at;

        -- 7e. Record Inventory Movement Audit Trail (Associated with Purchase)
        INSERT INTO public.inventory_movements (
            tenant_id,
            presentation_id,
            movement_type,
            quantity_change,
            quantity_before,
            quantity_after,
            reference_id,
            notes,
            created_at,
            created_by
        )
        VALUES (
            p_tenant_id,
            v_pres_id,
            'purchase',
            v_qty,
            v_prev_inv_qty,
            v_new_inv_qty,
            v_purchase_id,
            'Entrada por compra ' || v_folio_str,
            v_created_at,
            auth.uid()
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'folio', v_folio_str,
        'folio_number', v_next_folio_num,
        'supplier_name', v_supplier_name,
        'subtotal', v_total_subtotal,
        'total', v_total_subtotal,
        'created_at', v_created_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, TEXT, JSONB) TO anon, authenticated;
