import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runSuppliersTest() {
  console.log('=== TEST SUITE: Suppliers & Many-to-Many Presentations ===\n');

  try {
    // -------------------------------------------------------------------------
    // 1. Authenticate Tenant A
    // -------------------------------------------------------------------------
    const emailA = `supplier_tenant_a_${Date.now()}@example.com`;
    const password = 'Password123!';
    const { data: authA, error: authErrA } = await supabase.auth.signUp({ email: emailA, password });
    if (authErrA) throw authErrA;
    await supabase.auth.signInWithPassword({ email: emailA, password });

    const { data: tenantAData, error: tenantAErr } = await supabase.rpc('create_tenant_with_owner', {
      p_name: 'Cafetería & Tostador Tenant A',
      p_slug: `cafe-a-${Date.now()}`,
      p_business_type: 'Restaurante y Cafetería'
    });
    if (tenantAErr) throw tenantAErr;
    const tenantAId = tenantAData.tenant_id;
    console.log('✅ 1. Tenant A created successfully:', tenantAId);

    // -------------------------------------------------------------------------
    // 2. Test: Supplier with all optional fields empty
    // -------------------------------------------------------------------------
    const { data: emptySupplier, error: emptySuppErr } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: tenantAId,
        name: '',
        phone: '',
        email: '',
        notes: ''
      })
      .select()
      .single();
    if (emptySuppErr) throw emptySuppErr;
    console.log('✅ 2. Supplier with completely empty fields created:', emptySupplier.id);

    // -------------------------------------------------------------------------
    // 3. Test: Supplier with complete contact details
    // -------------------------------------------------------------------------
    const { data: fullSupplier, error: fullSuppErr } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: tenantAId,
        name: 'Distribuidora El Grano S.A.',
        phone: '55-1234-5678',
        email: 'ventas@elgrano.com',
        notes: 'Días de entrega: Martes y Jueves. Crédito 15 días.'
      })
      .select()
      .single();
    if (fullSuppErr) throw fullSuppErr;
    console.log('✅ 3. Supplier "Distribuidora El Grano S.A." created:', fullSupplier.id);

    const { data: secondSupplier, error: secSuppErr } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: tenantAId,
        name: 'Empaques e Insumos del Norte',
        phone: '81-8888-9999',
        email: 'contacto@empaquesnorte.com'
      })
      .select()
      .single();
    if (secSuppErr) throw secSuppErr;
    console.log('✅ 3b. Second supplier "Empaques e Insumos del Norte" created:', secondSupplier.id);

    // -------------------------------------------------------------------------
    // 4. Test: Mandatory supplier per presentation validation (Negative Test)
    // -------------------------------------------------------------------------
    let failedAsExpected = false;
    try {
      const { data: invalidProd, error: invalidErr } = await supabase.rpc('create_product_with_presentations', {
        p_tenant_id: tenantAId,
        p_name: 'Café Grano Especial',
        p_description: 'Arábica tostado medio',
        p_presentations: [
          { name: 'Bolsa 1 kg', price: 320.00, cost: 180.00 } // Notice NO supplier_id or supplier_ids
        ]
      });
      if (invalidErr) {
        failedAsExpected = true;
        console.log('✅ 4. Validation rejected product without supplier as expected:', invalidErr.message);
      }
    } catch (e) {
      failedAsExpected = true;
      console.log('✅ 4. Validation caught missing supplier exception as expected.');
    }

    if (!failedAsExpected) {
      console.error('❌ FAILED: Creating product without supplier should have failed!');
      process.exit(1);
    }

    // -------------------------------------------------------------------------
    // 5. Test: Create product with assigned supplier per presentation
    // -------------------------------------------------------------------------
    const { data: validProd, error: validErr } = await supabase.rpc('create_product_with_presentations', {
      p_tenant_id: tenantAId,
      p_name: 'Café Grano Especial',
      p_description: 'Arábica tostado medio',
      p_presentations: [
        { name: 'Bolsa 1 kg', price: 320.00, cost: 180.00, supplier_id: fullSupplier.id },
        { name: 'Bolsa 500 g', price: 180.00, cost: 95.00, supplier_id: fullSupplier.id }
      ]
    });
    if (validErr) throw validErr;
    console.log('✅ 5. Product with supplier created successfully. Group ID:', validProd.group_id);

    // -------------------------------------------------------------------------
    // 6. Test: Verify Many-to-Many: Add second supplier to the "Bolsa 1 kg" presentation
    // -------------------------------------------------------------------------
    // Fetch the 1 kg presentation ID
    const { data: presRows, error: presFetchErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('product_group_id', validProd.group_id);
    if (presFetchErr) throw presFetchErr;

    const pres1kg = presRows.find(p => p.name === 'Bolsa 1 kg');
    if (!pres1kg) throw new Error('Could not find Bolsa 1 kg presentation');

    const { data: addSuppRel, error: addSuppRelErr } = await supabase
      .from('supplier_presentations')
      .insert({
        tenant_id: tenantAId,
        supplier_id: secondSupplier.id,
        product_id: pres1kg.id,
        is_primary: false,
        last_purchase_cost: 175.00
      })
      .select()
      .single();
    if (addSuppRelErr) throw addSuppRelErr;
    console.log('✅ 6. Second supplier assigned to "Bolsa 1 kg" presentation (Many-to-Many verified)');

    // -------------------------------------------------------------------------
    // 7. Test: Unified query with nested suppliers
    // -------------------------------------------------------------------------
    const { data: fullCatalog, error: catQueryErr } = await supabase
      .from('product_groups')
      .select(`
        id,
        name,
        description,
        products (
          id,
          name,
          price,
          cost,
          status,
          supplier_presentations (
            id,
            supplier_id,
            last_purchase_cost,
            is_primary,
            suppliers (
              id,
              name,
              phone,
              email
            )
          )
        )
      `)
      .eq('id', validProd.group_id)
      .single();
    if (catQueryErr) throw catQueryErr;

    const query1kg = fullCatalog.products.find(p => p.name === 'Bolsa 1 kg');
    console.log(`✅ 7. Catalog query returned ${query1kg.supplier_presentations.length} suppliers for "Bolsa 1 kg":`,
      query1kg.supplier_presentations.map(sp => sp.suppliers?.name || 'Sin nombre').join(', ')
    );

    // -------------------------------------------------------------------------
    // 8. Test: Multi-tenant Isolation (Tenant B)
    // -------------------------------------------------------------------------
    const emailB = `supplier_tenant_b_${Date.now()}@example.com`;
    const { data: authB, error: authErrB } = await supabase.auth.signUp({ email: emailB, password });
    if (authErrB) throw authErrB;
    await supabase.auth.signInWithPassword({ email: emailB, password });

    const { data: tenantBData, error: tenantBErr } = await supabase.rpc('create_tenant_with_owner', {
      p_name: 'Boutique Tenant B',
      p_slug: `boutique-b-${Date.now()}`,
      p_business_type: 'Boutique y Moda'
    });
    if (tenantBErr) throw tenantBErr;
    const tenantBId = tenantBData.tenant_id;
    console.log('✅ 8. Tenant B created:', tenantBId);

    // Check suppliers visibility for Tenant B
    const { data: tenantBSuppliers, error: bSuppErr } = await supabase
      .from('suppliers')
      .select('*');
    if (bSuppErr) throw bSuppErr;

    if (tenantBSuppliers.length === 0) {
      console.log('✅ 9. Multi-Tenant RLS verified: Tenant B sees 0 suppliers from Tenant A');
    } else {
      console.error('❌ RLS BREACH: Tenant B saw Tenant A suppliers:', tenantBSuppliers);
      process.exit(1);
    }

    console.log('\n🎉 ALL SUPPLIERS & PRESENTATIONS TESTS PASSED SUCCESSFULLY! 🎉\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  }
}

runSuppliersTest();
