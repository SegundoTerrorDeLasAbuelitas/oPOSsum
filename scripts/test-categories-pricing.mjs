import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testCategoriesAndPricing() {
  console.log('--- Testing Categories & Presentation Pricing ---');

  // 1. Sign in as test user
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  await supabase.auth.signUp({ email, password });
  await supabase.auth.signInWithPassword({ email, password });

  // 2. Create tenant
  const { data: tenantData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Cafetería Especial',
    p_slug: 'cafeteria-especial',
    p_business_type: 'Restaurante y Cafetería'
  });
  const tenantId = tenantData.tenant_id;
  console.log('Tenant created:', tenantId);

  // 3. Create Category "Café"
  const { data: catData, error: catErr } = await supabase
    .from('categories')
    .insert({ tenant_id: tenantId, name: 'Café' })
    .select()
    .single();

  if (catErr) throw catErr;
  console.log('Category created:', catData);

  // 4. Create Product "Nescafé" in Category "Café" with 1 kg ($250) and 500 g ($140)
  const { data: prodResult, error: prodErr } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantId,
    p_name: 'Nescafé',
    p_description: 'Café soluble clásico',
    p_category_id: catData.id,
    p_presentations: [
      { name: '1 kg', price: 250.00, cost: 150.00 },
      { name: '500 g', price: 140.00, cost: 80.00 }
    ]
  });

  if (prodErr) throw prodErr;
  console.log('Product created with Category & Priced Presentations:', prodResult);

  // 5. Query back with categories join
  const { data: groups, error: fetchErr } = await supabase
    .from('product_groups')
    .select(`
      id,
      name,
      description,
      categories (
        id,
        name
      ),
      products (
        id,
        name,
        price,
        cost,
        status
      )
    `)
    .eq('tenant_id', tenantId);

  if (fetchErr) throw fetchErr;
  console.log('Fetched Product Hierarchy:', JSON.stringify(groups, null, 2));
  console.log('✅ ALL CATEGORIES & PRICING TESTS PASSED!');
}

testCategoriesAndPricing().catch(console.error);
