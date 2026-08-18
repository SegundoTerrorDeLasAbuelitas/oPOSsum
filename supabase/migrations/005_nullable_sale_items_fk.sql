-- =============================================================================
-- oPOSsum - Allow Product Deletion with Historical Sales Preservation
-- Migration: 005_nullable_sale_items_fk.sql
-- =============================================================================

-- 1. Ensure product_id in sale_items can be NULL when a product is deleted
ALTER TABLE public.sale_items 
ALTER COLUMN product_id DROP NOT NULL;

-- 2. Update foreign key to ON DELETE SET NULL
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public' 
      AND table_name = 'sale_items' 
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%product_id%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.sale_items DROP CONSTRAINT ' || quote_ident(v_constraint_name);
    END IF;

    ALTER TABLE public.sale_items 
    ADD CONSTRAINT sale_items_product_id_fkey 
    FOREIGN KEY (product_id) 
    REFERENCES public.products(id) 
    ON DELETE SET NULL;
END $$;
