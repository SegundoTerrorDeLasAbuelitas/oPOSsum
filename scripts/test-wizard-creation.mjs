import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runWizardCreationTest() {
  console.log('=== TEST SUITE: Sequential Wizard Creation & Multi-Supplier Purchase Costs ===\n');

  // 1. Authenticate user A
  const emailA = `test_wizard_${Date.now()}@example.com`;
  const password = 'Password123!';
  const { data: authDataA, error: authErrA } = await supabase.auth.signUp({ email: emailA, password });
  if (authErrA) throw authErrA;
  await supabase.auth.signInWithPassword({ email: emailA, password });

  // 2. Create Tenant A
  const { data: tenantAData, error: tenantAErr } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Abarrotes Don Pepe',
    p_slug: `don-pepe-${Date.now()}`,
    p_business_type: 'Tienda de Abarrotes'
  });
  if (tenantAErr) throw tenantAErr;
  const tenantAId = tenantAData.tenant_id;
  console.log('✅ Tenant A created:', tenantAId);

  // 3. Create Category "Café soluble"
  const { data: catData, error: catErr } = await supabase
    .from('categories')
    .insert({ tenant_id: tenantAId, name: 'Café soluble' })
    .select()
    .single();
  if (catErr) throw catErr;
  console.log('✅ Category created:', catData.name);

  // 4. Create Suppliers: Distribuidora ABC and Proveedor XYZ
  const { data: suppABC, error: suppErr1 } = await supabase
    .from('suppliers')
    .insert({ tenant_id: tenantAId, name: 'Distribuidora ABC', phone: '555-1001', email: 'abc@dist.com' })
    .select()
    .single();
  if (suppErr1) throw suppErr1;
  console.log('✅ Supplier 1 created:', suppABC.name);

  const { data: suppXYZ, error: suppErr2 } = await supabase
    .from('suppliers')
    .insert({ tenant_id: tenantAId, name: 'Proveedor XYZ', phone: '555-2002', email: 'xyz@proveedor.com' })
    .select()
    .single();
  if (suppErr2) throw suppErr2;
  console.log('✅ Supplier 2 created:', suppXYZ.name);

  // 5. Simulate Wizard Payload:
  // Presentation 1 ("1 kg"):
  // - Selling price: $250.00
  // - Supplier 1 (Distribuidora ABC): Purchase cost $180.00
  // - Supplier 2 (Proveedor XYZ): Purchase cost $175.00
  // Presentation 2 ("500 g"):
  // - Selling price: $140.00
  // - Supplier 1 (Distribuidora ABC, inherited): Purchase cost $95.00
  const wizardPayload = [
    {
      name: '1 kg',
      price: 250.00,
      suppliers: [
        { supplier_id: suppABC.id, cost: 180.00 },
        { supplier_id: suppXYZ.id, cost: 175.00 }
      ]
    },
    {
      name: '500 g',
      price: 140.00,
      suppliers: [
        { supplier_id: suppABC.id, cost: 95.00 }
      ]
    }
  ];

  console.log('\n🚀 Invoking create_product_with_presentations RPC with multi-supplier purchase costs...');
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantAId,
    p_name: 'Nescafé',
    p_description: 'Café soluble tradicional',
    p_category_id: catData.id,
    p_presentations: wizardPayload
  });

  if (rpcErr) throw rpcErr;
  console.log('✅ Product created atomically:', rpcResult);

  // 6. Query and verify exact database records
  const { data: productGroup, error: groupErr } = await supabase
    .from('product_groups')
    .select(`
      id,
      name,
      description,
      category_id,
      categories (id, name),
      products (
        id,
        name,
        price,
        cost,
        supplier_presentations (
          id,
          supplier_id,
          last_purchase_cost,
          is_primary,
          suppliers (id, name)
        )
      )
    `)
    .eq('id', rpcResult.group_id)
    .single();

  if (groupErr) throw groupErr;

  console.log('\n🔍 Verifying Supabase Data Integrity:');
  console.log(`- Product Group: "${productGroup.name}" [Category: ${productGroup.categories?.name}]`);
  console.log(`- Number of presentations: ${productGroup.products.length}`);

  if (productGroup.products.length !== 2) {
    throw new Error('Expected 2 presentations to be created.');
  }

  const pres1kg = productGroup.products.find(p => p.name === '1 kg');
  const pres500g = productGroup.products.find(p => p.name === '500 g');

  console.log(`\n📌 Checking Presentation 1 ("1 kg"):`);
  console.log(`   * Selling Price: $${pres1kg.price} (Expected: $250.00)`);
  if (parseFloat(pres1kg.price) !== 250) throw new Error('Selling price mismatch for 1 kg');

  console.log(`   * Suppliers associated: ${pres1kg.supplier_presentations.length} (Expected: 2)`);
  if (pres1kg.supplier_presentations.length !== 2) throw new Error('Expected 2 suppliers for 1 kg');

  pres1kg.supplier_presentations.forEach(sp => {
    console.log(`     - Supplier: "${sp.suppliers?.name}", Purchase Cost: $${sp.last_purchase_cost}`);
  });

  const costABC_1kg = pres1kg.supplier_presentations.find(sp => sp.supplier_id === suppABC.id)?.last_purchase_cost;
  const costXYZ_1kg = pres1kg.supplier_presentations.find(sp => sp.supplier_id === suppXYZ.id)?.last_purchase_cost;

  if (parseFloat(costABC_1kg) !== 180.00) throw new Error(`Expected ABC cost $180.00, got $${costABC_1kg}`);
  if (parseFloat(costXYZ_1kg) !== 175.00) throw new Error(`Expected XYZ cost $175.00, got $${costXYZ_1kg}`);
  console.log('   ✅ Presentation 1 suppliers and individual purchase costs match 100%!');

  console.log(`\n📌 Checking Presentation 2 ("500 g"):`);
  console.log(`   * Selling Price: $${pres500g.price} (Expected: $140.00)`);
  if (parseFloat(pres500g.price) !== 140) throw new Error('Selling price mismatch for 500 g');

  console.log(`   * Suppliers associated: ${pres500g.supplier_presentations.length} (Expected: 1)`);
  if (pres500g.supplier_presentations.length !== 1) throw new Error('Expected 1 supplier for 500 g');

  const costABC_500g = pres500g.supplier_presentations.find(sp => sp.supplier_id === suppABC.id)?.last_purchase_cost;
  console.log(`     - Supplier: "${pres500g.supplier_presentations[0].suppliers?.name}", Purchase Cost: $${costABC_500g}`);
  if (parseFloat(costABC_500g) !== 95.00) throw new Error(`Expected ABC cost $95.00, got $${costABC_500g}`);
  console.log('   ✅ Presentation 2 supplier and purchase cost match 100%!');

  // 7. Test Multi-tenant RLS Isolation with Tenant B
  console.log('\n🔒 Testing Multi-Tenant Isolation:');
  const emailB = `test_tenant_b_${Date.now()}@example.com`;
  await supabase.auth.signUp({ email: emailB, password });
  await supabase.auth.signInWithPassword({ email: emailB, password });

  const { data: tenantBData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Ferretería El Tornillo',
    p_slug: `el-tornillo-${Date.now()}`,
    p_business_type: 'Ferretería'
  });

  const { data: tenantBProducts } = await supabase
    .from('product_groups')
    .select('id, name');

  console.log(`- Tenant B queried product_groups: ${tenantBProducts.length} items visible.`);
  if (tenantBProducts.length !== 0) {
    throw new Error('RLS VIOLATION: Tenant B could see Tenant A products!');
  }
  console.log('✅ RLS isolation confirmed!');

  console.log('\n🎉 ALL WIZARD CREATION & MULTI-SUPPLIER TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runWizardCreationTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
