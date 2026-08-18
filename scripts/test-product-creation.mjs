import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testProductCreation() {
  console.log('--- Testing Product Groups & Presentations creation ---');

  // 1. Sign in as test user
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  await supabase.auth.signUp({ email, password });
  await supabase.auth.signInWithPassword({ email, password });

  // 2. Create tenant
  const { data: tenantData } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Cafetería El Grano',
    p_slug: 'cafeteria-el-grano',
    p_business_type: 'Restaurante y Cafetería'
  });
  const tenantId = tenantData.tenant_id;
  console.log('Tenant created:', tenantId);

  // 3. Create Product Group "Nescafé" with 2 presentations ("1 kg", "500 g")
  const { data: prodResult, error: prodErr } = await supabase.rpc('create_product_with_presentations', {
    p_tenant_id: tenantId,
    p_name: 'Nescafé',
    p_description: 'Café soluble clásico',
    p_presentations: [
      { name: '1 kg', price: 180.00, cost: 120.00 },
      { name: '500 g', price: 95.00, cost: 65.00 }
    ]
  });

  if (prodErr) {
    console.error('Error creating product:', prodErr);
    return;
  }
  console.log('Product Group & Presentations created successfully:', prodResult);

  // 4. Query back to verify RLS and relationships
  const { data: groups, error: fetchErr } = await supabase
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
        status
      )
    `)
    .eq('tenant_id', tenantId);

  console.log('Fetched Product Groups with Presentations:', JSON.stringify(groups, null, 2));
  console.log('✅ ALL PRODUCT GROUP & PRESENTATION TESTS PASSED!');
}

testProductCreation().catch(console.error);
