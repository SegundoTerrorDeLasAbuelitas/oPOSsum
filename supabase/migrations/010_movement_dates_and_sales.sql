-- =============================================================================
-- oPOSsum - Movement Dates for Sales & Purchases, Monthly Grouping Support
-- Migration: 010_movement_dates_and_sales.sql
-- =============================================================================

-- 1. Add sale_date column to sales table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'sales' 
          AND column_name = 'sale_date'
    ) THEN
        ALTER TABLE public.sales ADD COLUMN sale_date DATE DEFAULT CURRENT_DATE;
    END IF;
END $$;

-- 2. Backfill existing records with date derived from created_at
UPDATE public.sales 
SET sale_date = (created_at AT TIME ZONE 'America/Mexico_City')::DATE 
WHERE sale_date IS NULL;

-- 3. Optimization Indexes for Period Queries
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON public.sales(tenant_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_date ON public.purchases(tenant_id, purchase_date DESC);

-- 4. Drop legacy signature and create updated create_sale_checkout function with p_sale_date parameter
DROP FUNCTION IF EXISTS public.create_sale_checkout(UUID, TEXT, JSONB, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.create_sale_checkout(
    p_tenant_id UUID,
    p_customer_name TEXT,
    p_items JSONB,
    p_discount_amount NUMERIC DEFAULT 0.00,
    p_payment_method TEXT DEFAULT 'cash',
    p_sale_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next_folio_num INT;
    v_folio_str TEXT;
    v_sale_id UUID;
    v_item JSONB;
    v_prod_id UUID;
    v_prod_name TEXT;
    v_unit_price NUMERIC;
    v_qty NUMERIC;
    v_item_subtotal NUMERIC;
    v_total_subtotal NUMERIC := 0.00;
    v_final_total NUMERIC := 0.00;
    v_discount NUMERIC := COALESCE(p_discount_amount, 0.00);
    v_created_at TIMESTAMPTZ := now();
    v_movement_date DATE := COALESCE(p_sale_date, CURRENT_DATE);
    v_items_count INT := 0;
BEGIN
    -- 1. Validate Tenant Access
    IF NOT public.has_tenant_access(p_tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado al negocio especificado';
    END IF;

    -- 2. Validate Items array
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El carrito de venta está vacío';
    END IF;

    -- 3. Concurrency-Safe Next Folio Calculation per Tenant
    SELECT COALESCE(MAX(folio_number), 0) + 1 
    INTO v_next_folio_num
    FROM public.sales
    WHERE tenant_id = p_tenant_id;

    v_folio_str := 'V-' || lpad(v_next_folio_num::text, 6, '0');

    -- 4. Calculate Subtotal and Validate Products
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := (v_item->>'product_id')::UUID;
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1);
        v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0.00);

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a 0';
        END IF;

        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'El precio unitario no puede ser negativo';
        END IF;

        v_item_subtotal := round(v_qty * v_unit_price, 2);
        v_total_subtotal := v_total_subtotal + v_item_subtotal;
        v_items_count := v_items_count + 1;
    END LOOP;

    IF v_items_count = 0 THEN
        RAISE EXCEPTION 'No se proporcionaron productos válidos para la venta';
    END IF;

    IF v_discount < 0 THEN
        v_discount := 0.00;
    END IF;

    v_final_total := GREATEST(0.00, v_total_subtotal - v_discount);

    -- 5. Insert Sale Header with historical sale_date
    INSERT INTO public.sales (
        tenant_id,
        user_id,
        folio,
        folio_number,
        customer_name,
        sale_date,
        subtotal,
        discount_amount,
        total,
        payment_method,
        status,
        created_at,
        updated_at
    )
    VALUES (
        p_tenant_id,
        auth.uid(),
        v_folio_str,
        v_next_folio_num,
        COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente Mostrador'),
        v_movement_date,
        v_total_subtotal,
        v_discount,
        v_final_total,
        COALESCE(p_payment_method, 'cash'),
        'completed',
        v_created_at,
        v_created_at
    )
    RETURNING id INTO v_sale_id;

    -- 6. Insert Sale Items with Price Snapshot
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := (v_item->>'product_id')::UUID;
        v_prod_name := trim(COALESCE(v_item->>'product_name', 'Producto'));
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1);
        v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0.00);
        v_item_subtotal := round(v_qty * v_unit_price, 2);

        INSERT INTO public.sale_items (
            tenant_id,
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            subtotal,
            created_at
        )
        VALUES (
            p_tenant_id,
            v_sale_id,
            v_prod_id,
            v_prod_name,
            v_qty,
            v_unit_price,
            v_item_subtotal,
            v_created_at
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'folio', v_folio_str,
        'folio_number', v_next_folio_num,
        'sale_date', v_movement_date,
        'subtotal', v_total_subtotal,
        'discount', v_discount,
        'total', v_final_total,
        'created_at', v_created_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale_checkout(UUID, TEXT, JSONB, NUMERIC, TEXT, DATE) TO anon, authenticated;
