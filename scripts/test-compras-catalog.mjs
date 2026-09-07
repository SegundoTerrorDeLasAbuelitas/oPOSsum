import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runComprasCatalogTest() {
  console.log('=== TEST: Compras Unified Catalog & Context Synchronization ===\n');

  // 1. Authenticate user A
  const emailA = `test_tenant_a_${Date.now()}@example.com`;
  const password = 'Password123!';
  const { data: authDataA, error: authErrA } = await supabase.auth.signUp({ email: emailA, password });
  if (authErrA) throw authErrA;
  await supabase.auth.signInWithPassword({ email: emailA, password });

  // 2. Create Tenant A
  const { data: tenantAData, error: tenantAErr } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Cafetería La Central',
    p_slug: `la-central-${Date.now()}`,
    p_business_type: 'Restaurante y Cafetería'
  });
  if (tenantAErr) throw tenantAErr;
  const tenantAId = tenantAData.tenant_id;
  console.log('✅ Tenant A created:', tenantAId);

  // 3. Create Category "Café"
  const { data: catData, error: catErr } = await supabase
    .from('categories')
    .insert({ tenant_id: tenantAId, name: 'Café' })
    .select()
    .single();
  if (catErr) throw catErr;
  console.log('✅ Category "Café" created:', catData.id);

  // 3b. Create a Supplier for Tenant A
  const { data: suppData, error: suppErr } = await supabase
    .from('suppliers')
    .insert({ tenant_id: tenantAId, name: 'Distribuidora Café de Altura' })
    .select()
    .single();
  if (suppErr) throw suppErr;
  console.log('✅ Supplier created:', suppData.id);

  // 4. Create Product "Nescafé" from Productos context with 1 kg ($250) and 500 g ($140)
  const { data: prod1Result, error: prod1Err } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantAId,
    p_name: 'Nescafé',
    p_description: 'Café soluble tradicional',
    p_category_id: catData.id,
    p_presentations: [
      { name: '1 kg', price: 250.00, supplier_id: suppData.id },
      { name: '500 g', price: 140.00, supplier_id: suppData.id }
    ]
  });
  if (prod1Err) throw prod1Err;
  console.log('✅ Product "Nescafé" created via Productos context:', prod1Result.group_id);

  // 5. Query the unified catalog as Compras does
  const { data: comprasCatalog1, error: fetchErr1 } = await supabase
    .from('product_groups')
    .select(`
      id,
      name,
      description,
      category_id,
      categories (id, name),
      products (id, name, price, cost, status)
    `)
    .eq('tenant_id', tenantAId)
    .order('created_at', { ascending: false });
  if (fetchErr1) throw fetchErr1;

  console.log(`✅ Compras view retrieved ${comprasCatalog1.length} product group(s) from Supabase:`);
  console.log(`   - Group: "${comprasCatalog1[0].name}" [Category: ${comprasCatalog1[0].categories?.name}]`);
  console.log(`   - Presentations:`, comprasCatalog1[0].products.map(p => `${p.name} ($${p.price})`).join(', '));

  if (comprasCatalog1.length !== 1 || comprasCatalog1[0].products.length !== 2) {
    throw new Error('Fallo en la prueba 1: Compras debe mostrar exactamente 1 grupo con 2 presentaciones.');
  }

  // 6. Create Product "Garat" from Compras context (reusing the same RPC with 500 g)
  const { data: prod2Result, error: prod2Err } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantAId,
    p_name: 'Garat',
    p_description: 'Café gourmet tostado',
    p_category_id: catData.id,
    p_presentations: [
      { name: '500 g', price: 185.00, supplier_id: suppData.id }
    ]
  });
  if (prod2Err) throw prod2Err;
  console.log('✅ Product "Garat" created via Compras context:', prod2Result.group_id);

  // 7. Verify that both products now appear in the catalog
  const { data: unifiedCatalog, error: fetchErr2 } = await supabase
    .from('product_groups')
    .select(`
      id,
      name,
      description,
      category_id,
      categories (id, name),
      products (id, name, price, cost, status)
    `)
    .eq('tenant_id', tenantAId)
    .order('created_at', { ascending: false });
  if (fetchErr2) throw fetchErr2;

  console.log(`✅ Unified catalog now has ${unifiedCatalog.length} product group(s):`);
  unifiedCatalog.forEach(g => {
    console.log(`   * ${g.name} (${g.categories?.name}): ${g.products.map(p => p.name).join(', ')}`);
  });

  if (unifiedCatalog.length !== 2) {
    throw new Error('Fallo en la prueba 2: El catálogo unificado debe tener 2 productos.');
  }

  // 8. Test Edit: Update Nescafé description and price of 1 kg
  const nescafegroup = unifiedCatalog.find(g => g.name === 'Nescafé');
  const pres1kg = nescafegroup.products.find(p => p.name === '1 kg');

  await supabase
    .from('product_groups')
    .update({ description: 'Café soluble edición especial' })
    .eq('id', nescafegroup.id);

  await supabase
    .from('products')
    .update({ price: 265.00 })
    .eq('id', pres1kg.id);

  const { data: updatedGroup } = await supabase
    .from('product_groups')
    .select('description, products(id, name, price)')
    .eq('id', nescafegroup.id)
    .single();

  const updatedPres1kg = updatedGroup.products.find(p => p.name === '1 kg');
  console.log(`✅ Product edited: desc="${updatedGroup.description}", new price 1 kg=$${updatedPres1kg.price}`);
  if (updatedPres1kg.price !== 265) {
    throw new Error('Fallo en la prueba 3: La edición debe reflejarse inmediatamente.');
  }

  // 9. Test Delete: Delete presentation "500 g" of Nescafé
  const pres500g = nescafegroup.products.find(p => p.name === '500 g');
  await supabase
    .from('products')
    .delete()
    .eq('id', pres500g.id);

  const { data: remainingPres } = await supabase
    .from('products')
    .select('id, name')
    .eq('product_group_id', nescafegroup.id);

  console.log(`✅ Presentation deleted: remaining presentations for Nescafé:`, remainingPres.map(p => p.name));
  if (remainingPres.length !== 1 || remainingPres[0].name !== '1 kg') {
    throw new Error('Fallo en la prueba 4: La presentación eliminada no debe aparecer en Compras ni Productos.');
  }

  // 10. Test Multi-tenant RLS Isolation with Tenant B
  console.log('\n--- Testing Multi-Tenant Isolation with Tenant B ---');
  const emailB = `test_tenant_b_${Date.now()}@example.com`;
  await supabase.auth.signUp({ email: emailB, password });
  await supabase.auth.signInWithPassword({ email: emailB, password });

  const { data: tenantBData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Boutique La Moda',
    p_slug: `boutique-${Date.now()}`,
    p_business_type: 'Tienda de Ropa'
  });
  const tenantBId = tenantBData.tenant_id;
  console.log('✅ Tenant B created:', tenantBId);

  // Query products as Tenant B
  const { data: tenantBProducts } = await supabase
    .from('product_groups')
    .select('id, name');

  console.log(`✅ Tenant B queried product_groups: ${tenantBProducts.length} items found.`);
  if (tenantBProducts.length !== 0) {
    throw new Error('VIOLACIÓN DE AISLAMIENTO: Tenant B pudo ver productos de Tenant A!');
  }

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Compras and Productos share the exact same Supabase catalog with complete tenant isolation.\n');
  process.exit(0);
}

runComprasCatalogTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
