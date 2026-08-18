import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testEditAndDeleteFlow() {
  console.log('--- Testing Edit & Delete Flow with Historical Sales Preservation ---');

  // 1. Sign in as test user
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  await supabase.auth.signUp({ email, password });
  await supabase.auth.signInWithPassword({ email, password });

  // 2. Create tenant
  const { data: tenantData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Abarrotes Don Pepe',
    p_slug: 'don-pepe',
    p_business_type: 'Tienda de Abarrotes'
  });
  const tenantId = tenantData.tenant_id;

  // 3. Create Category "Café"
  const { data: catData } = await supabase
    .from('categories')
    .insert({ tenant_id: tenantId, name: 'Café' })
    .select()
    .single();

  // 4. Create Product "Nescafé" with 1 kg ($250) and 500 g ($140)
  const { data: prodResult } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantId,
    p_name: 'Nescafé',
    p_description: 'Café soluble',
    p_category_id: catData.id,
    p_presentations: [
      { name: '1 kg', price: 250.00 },
      { name: '500 g', price: 140.00 }
    ]
  });

  const { data: presentations } = await supabase
    .from('products')
    .select('id, name, price')
    .eq('product_group_id', prodResult.group_id);

  const pres1kg = presentations.find(p => p.name === '1 kg');
  const pres500g = presentations.find(p => p.name === '500 g');

  // 5. Create a Sale using 1 kg ($250)
  const { data: saleData } = await supabase.rpc('create_sale_checkout', {
    p_tenant_id: tenantId,
    p_customer_name: 'Cliente Mostrador',
    p_items: [
      { product_id: pres1kg.id, product_name: 'Nescafé — 1 kg', quantity: 1, unit_price: 250.00 }
    ]
  });
  console.log('Created historical sale:', saleData.folio);

  // 6. EDIT PRESENTATION: Update 500 g price to $150
  const { data: updatedPres } = await supabase
    .from('products')
    .update({ price: 150.00 })
    .eq('id', pres500g.id)
    .select()
    .single();

  if (updatedPres.price !== 150) {
    throw new Error('Failed to update presentation price to 150');
  }
  console.log('✅ Updated presentation price successfully to $150.00');

  // 7. DELETE PRESENTATION: Delete 500 g (no sales associated)
  const { error: delPresErr } = await supabase
    .from('products')
    .delete()
    .eq('id', pres500g.id);

  if (delPresErr) throw delPresErr;
  console.log('✅ Deleted presentation 500 g from Supabase');

  // 8. DELETE PRODUCT GROUP: Delete Nescafé (which was used in a sale)
  const { error: delGroupErr } = await supabase
    .from('product_groups')
    .delete()
    .eq('id', prodResult.group_id);

  if (delGroupErr) throw delGroupErr;
  console.log('✅ Deleted product group Nescafé from Supabase');

  // 9. VERIFY: Category "Café" still exists
  const { data: catCheck } = await supabase
    .from('categories')
    .select('id, name')
    .eq('id', catData.id);

  if (catCheck.length === 0) {
    throw new Error('Category was erroneously deleted when deleting product group!');
  }
  console.log('✅ Category "Café" still exists!');

  // 10. VERIFY: Sale item still has product_name "Nescafé — 1 kg" and unit_price 250
  const { data: saleItemCheck } = await supabase
    .from('sale_items')
    .select('id, product_name, unit_price, subtotal, product_id')
    .eq('sale_id', saleData.sale_id);

  console.log('Historical Sale Item after product deletion:', saleItemCheck);
  if (saleItemCheck[0].product_name !== 'Nescafé — 1 kg' || saleItemCheck[0].unit_price !== 250) {
    throw new Error('Historical sale item data was corrupted!');
  }
  console.log('✅ Historical sales data is 100% intact!');

  console.log('🎉 ALL EDIT & DELETE TESTS PASSED!');
}

testEditAndDeleteFlow().catch(console.error);
