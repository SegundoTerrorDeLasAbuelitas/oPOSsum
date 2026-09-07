-- =============================================================================
-- oPOSsum - Migration 007: Supplier Purchase Cost & Multi-Supplier RPC
-- =============================================================================

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
    v_supplier_item JSONB;
    v_supplier_id UUID;
    v_purchase_cost NUMERIC;
    v_is_primary BOOLEAN;
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
            
            -- Check "suppliers" array of objects [{supplier_id, cost}]
            IF v_pres->'suppliers' IS NOT NULL AND jsonb_array_length(v_pres->'suppliers') > 0 THEN
                v_has_supplier := true;
            -- Check legacy single "supplier_id"
            ELSIF v_pres->>'supplier_id' IS NOT NULL AND length(trim(v_pres->>'supplier_id')) > 0 THEN
                v_has_supplier := true;
            -- Check legacy array "supplier_ids"
            ELSIF v_pres->'supplier_ids' IS NOT NULL AND jsonb_array_length(v_pres->'supplier_ids') > 0 THEN
                v_has_supplier := true;
            END IF;

            IF NOT v_has_supplier THEN
                RAISE EXCEPTION 'Selecciona al menos un proveedor para la presentación "%"', v_pres_name;
            END IF;
        END IF;
    END LOOP;

    -- 6. Insert Product Group (Atomic)
    INSERT INTO public.product_groups (tenant_id, category_id, name, description)
    VALUES (p_tenant_id, p_category_id, trim(p_name), NULLIF(trim(p_description), ''))
    RETURNING id INTO v_group_id;

    -- 7. Insert Presentations & Supplier Relationships with Purchase Costs
    FOR v_pres IN SELECT * FROM jsonb_array_elements(p_presentations)
    LOOP
        v_pres_name := trim(COALESCE(v_pres->>'name', ''));
        IF length(v_pres_name) > 0 THEN
            v_pres_price := COALESCE((v_pres->>'price')::NUMERIC, 0.00);
            v_pres_cost := COALESCE((v_pres->>'cost')::NUMERIC, 0.00);

            IF v_pres_price < 0 THEN
                RAISE EXCEPTION 'El precio de "%" no puede ser negativo', v_pres_name;
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

            -- In case it existed
            IF v_product_id IS NULL THEN
                SELECT id INTO v_product_id 
                FROM public.products 
                WHERE product_group_id = v_group_id AND name = v_pres_name;
            END IF;

            -- A) Process new structured "suppliers" array: [{supplier_id, cost}]
            IF v_pres->'suppliers' IS NOT NULL AND jsonb_array_length(v_pres->'suppliers') > 0 THEN
                v_is_primary := true;
                FOR v_supplier_item IN SELECT * FROM jsonb_array_elements(v_pres->'suppliers')
                LOOP
                    IF v_supplier_item->>'supplier_id' IS NOT NULL AND length(trim(v_supplier_item->>'supplier_id')) > 0 THEN
                        v_supplier_id := (v_supplier_item->>'supplier_id')::UUID;
                        v_purchase_cost := COALESCE((v_supplier_item->>'cost')::NUMERIC, 0.00);

                        IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = p_tenant_id) THEN
                            INSERT INTO public.supplier_presentations (
                                tenant_id,
                                supplier_id,
                                product_id,
                                last_purchase_cost,
                                is_primary
                            )
                            VALUES (
                                p_tenant_id,
                                v_supplier_id,
                                v_product_id,
                                v_purchase_cost,
                                v_is_primary
                            )
                            ON CONFLICT (supplier_id, product_id) DO UPDATE
                            SET last_purchase_cost = EXCLUDED.last_purchase_cost,
                                updated_at = now();

                            v_is_primary := false;
                        END IF;
                    END IF;
                END LOOP;

            -- B) Fallback: legacy single "supplier_id"
            ELSIF v_pres->>'supplier_id' IS NOT NULL AND length(trim(v_pres->>'supplier_id')) > 0 THEN
                v_supplier_id := (v_pres->>'supplier_id')::UUID;
                v_purchase_cost := COALESCE((v_pres->>'cost')::NUMERIC, 0.00);
                IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = p_tenant_id) THEN
                    INSERT INTO public.supplier_presentations (
                        tenant_id,
                        supplier_id,
                        product_id,
                        last_purchase_cost,
                        is_primary
                    )
                    VALUES (
                        p_tenant_id,
                        v_supplier_id,
                        v_product_id,
                        v_purchase_cost,
                        true
                    )
                    ON CONFLICT (supplier_id, product_id) DO UPDATE
                    SET last_purchase_cost = EXCLUDED.last_purchase_cost,
                        updated_at = now();
                END IF;

            -- C) Fallback: legacy array "supplier_ids"
            ELSIF v_pres->'supplier_ids' IS NOT NULL AND jsonb_array_length(v_pres->'supplier_ids') > 0 THEN
                v_is_primary := true;
                FOR v_supplier_item IN SELECT * FROM jsonb_array_elements(v_pres->'supplier_ids')
                LOOP
                    v_supplier_id := trim(v_supplier_item::text, '"')::UUID;
                    IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = p_tenant_id) THEN
                        INSERT INTO public.supplier_presentations (
                            tenant_id,
                            supplier_id,
                            product_id,
                            last_purchase_cost,
                            is_primary
                        )
                        VALUES (
                            p_tenant_id,
                            v_supplier_id,
                            v_product_id,
                            0.00,
                            v_is_primary
                        )
                        ON CONFLICT (supplier_id, product_id) DO NOTHING;

                        v_is_primary := false;
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
