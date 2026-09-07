-- =============================================================================
-- oPOSsum - Inventory Schema (Multi-Tenant & Per-Presentation)
-- Migration: 008_create_inventory_table.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. INVENTORY TABLE
-- Relates directly to individual product presentation (public.products.id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    presentation_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_tenant_presentation UNIQUE (tenant_id, presentation_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON public.inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_presentation ON public.inventory(presentation_id);

-- -----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inventory of their tenant" ON public.inventory;
CREATE POLICY "Users can view inventory of their tenant"
    ON public.inventory
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert inventory in their tenant" ON public.inventory;
CREATE POLICY "Users can insert inventory in their tenant"
    ON public.inventory
    FOR INSERT
    WITH CHECK (
        tenant_id IN (SELECT public.get_user_tenant_ids())
        AND presentation_id IN (SELECT id FROM public.products WHERE tenant_id = inventory.tenant_id)
    );

DROP POLICY IF EXISTS "Users can update inventory in their tenant" ON public.inventory;
CREATE POLICY "Users can update inventory in their tenant"
    ON public.inventory
    FOR UPDATE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
    WITH CHECK (
        tenant_id IN (SELECT public.get_user_tenant_ids())
        AND presentation_id IN (SELECT id FROM public.products WHERE tenant_id = inventory.tenant_id)
    );

DROP POLICY IF EXISTS "Users can delete inventory in their tenant" ON public.inventory;
CREATE POLICY "Users can delete inventory in their tenant"
    ON public.inventory
    FOR DELETE
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 3. INVENTORY MOVEMENTS TABLE (Audit Trail Preparation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    presentation_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('initial', 'manual_adjustment', 'purchase', 'sale', 'return', 'waste')),
    quantity_change NUMERIC(12,2) NOT NULL,
    quantity_before NUMERIC(12,2) NOT NULL,
    quantity_after NUMERIC(12,2) NOT NULL,
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_tenant ON public.inventory_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_presentation ON public.inventory_movements(presentation_id);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inventory movements of their tenant" ON public.inventory_movements;
CREATE POLICY "Users can view inventory movements of their tenant"
    ON public.inventory_movements
    FOR SELECT
    USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can insert inventory movements in their tenant" ON public.inventory_movements;
CREATE POLICY "Users can insert inventory movements in their tenant"
    ON public.inventory_movements
    FOR INSERT
    WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 4. ATOMIC UPSERT INVENTORY RPC
-- Helper function to set or adjust presentation inventory cleanly
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_presentation_inventory(
    p_tenant_id UUID,
    p_presentation_id UUID,
    p_quantity NUMERIC(12,2),
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prev_qty NUMERIC(12,2) := 0.00;
    v_new_record public.inventory%ROWTYPE;
BEGIN
    -- Verify user belongs to tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Usuario no autorizado para modificar el inventario de este tenant';
    END IF;

    -- Verify presentation belongs to tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = p_presentation_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'La presentación no existe o no pertenece a este tenant';
    END IF;

    -- Get current quantity if exists
    SELECT quantity INTO v_prev_qty
    FROM public.inventory
    WHERE tenant_id = p_tenant_id AND presentation_id = p_presentation_id;

    IF v_prev_qty IS NULL THEN
        v_prev_qty := 0.00;
    END IF;

    -- UPSERT into inventory table
    INSERT INTO public.inventory (tenant_id, presentation_id, quantity, updated_at)
    VALUES (p_tenant_id, p_presentation_id, GREATEST(0.00, p_quantity), now())
    ON CONFLICT (tenant_id, presentation_id)
    DO UPDATE SET 
        quantity = GREATEST(0.00, EXCLUDED.quantity),
        updated_at = now()
    RETURNING * INTO v_new_record;

    -- Record movement audit trail
    INSERT INTO public.inventory_movements (
        tenant_id,
        presentation_id,
        movement_type,
        quantity_change,
        quantity_before,
        quantity_after,
        notes,
        created_by
    )
    VALUES (
        p_tenant_id,
        p_presentation_id,
        'manual_adjustment',
        (v_new_record.quantity - v_prev_qty),
        v_prev_qty,
        v_new_record.quantity,
        COALESCE(p_notes, 'Ajuste manual de inventario'),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'presentation_id', v_new_record.presentation_id,
        'quantity', v_new_record.quantity,
        'previous_quantity', v_prev_qty,
        'updated_at', v_new_record.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_presentation_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated, anon;
