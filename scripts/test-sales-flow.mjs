import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSalesFlow() {
  console.log('--- Testing Sales & Folios Flow ---');

  // 1. Sign in as test user
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  await supabase.auth.signUp({ email, password });
  await supabase.auth.signInWithPassword({ email, password });

  // 2. Create tenant
  const { data: tenantData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Minisuper El Sol',
    p_slug: 'minisuper-el-sol',
    p_business_type: 'Tienda de Abarrotes'
  });
  const tenantId = tenantData.tenant_id;
  console.log('Tenant created:', tenantId);

  // 3. Create Category and Product
  const { data: catData } = await supabase
    .from('categories')
    .insert({ tenant_id: tenantId, name: 'Bebidas' })
    .select()
    .single();

  const { data: prodResult } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantId,
    p_name: 'Café soluble Nescafé',
    p_description: 'Frasco de vidrio',
    p_category_id: catData.id,
    p_presentations: [
      { name: '1 kg', price: 250.00, cost: 150.00 },
      { name: '500 g', price: 140.00, cost: 80.00 }
    ]
  });

  const { data: products } = await supabase
    .from('products')
    .select('id, name, price')
    .eq('product_group_id', prodResult.group_id);

  const pres1kg = products.find(p => p.name === '1 kg');
  const pres500g = products.find(p => p.name === '500 g');
  console.log('Presentations created:', { pres1kg, pres500g });

  // 4. Perform Sale 1 (1x 1kg @ $250 + 2x 500g @ $140 = $530)
  const { data: sale1, error: sErr1 } = await supabase.rpc('create_sale_checkout', {
    p_tenant_id: tenantId,
    p_customer_name: 'Cliente Mostrador',
    p_items: [
      { product_id: pres1kg.id, product_name: 'Nescafé — 1 kg', quantity: 1, unit_price: 250.00 },
      { product_id: pres500g.id, product_name: 'Nescafé — 500 g', quantity: 2, unit_price: 140.00 }
    ],
    p_discount_amount: 0.00,
    p_payment_method: 'cash'
  });

  if (sErr1) throw sErr1;
  console.log('Sale 1 Checkout Result:', sale1);

  // 5. Perform Sale 2 (1x 1kg @ $250 = $250)
  const { data: sale2, error: sErr2 } = await supabase.rpc('create_sale_checkout', {
    p_tenant_id: tenantId,
    p_customer_name: 'Juan Perez',
    p_items: [
      { product_id: pres1kg.id, product_name: 'Nescafé — 1 kg', quantity: 1, unit_price: 250.00 }
    ],
    p_discount_amount: 0.00,
    p_payment_method: 'card'
  });

  if (sErr2) throw sErr2;
  console.log('Sale 2 Checkout Result:', sale2);

  // 6. Query Sales History & Items
  const { data: salesHistory, error: hErr } = await supabase
    .from('sales')
    .select(`
      id,
      folio,
      folio_number,
      customer_name,
      subtotal,
      total,
      created_at,
      sale_items (
        id,
        product_id,
        product_name,
        quantity,
        unit_price,
        subtotal
      )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (hErr) throw hErr;
  console.log('Sales History from Supabase:', JSON.stringify(salesHistory, null, 2));

  // 7. Verify Folios: Sale 1 = V-000001, Sale 2 = V-000002
  if (sale1.folio !== 'V-000001' || sale2.folio !== 'V-000002') {
    throw new Error(`Folio generation mismatch: expected V-000001 and V-000002, got ${sale1.folio} and ${sale2.folio}`);
  }

  console.log('✅ ALL SALES & FOLIOS TESTS PASSED SUCCESSFULLY!');
}

testSalesFlow().catch(console.error);
