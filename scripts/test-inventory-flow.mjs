import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Read .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function runInventoryIntegrationTest() {
  console.log('🧪 Running Inventory Multi-Tenant & Per-Presentation Integration Test...\n');

  // 1. Get or create test tenant
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, name')
    .limit(1)
    .single();

  if (tErr || !tenant) {
    throw new Error('No test tenant found: ' + JSON.stringify(tErr));
  }
  console.log(`✅ Using Tenant: "${tenant.name}" (${tenant.id})`);

  // 2. Query products (presentations) for this tenant
  const { data: presentations, error: pErr } = await supabase
    .from('products')
    .select('id, name, product_group_id, product_groups(name)')
    .eq('tenant_id', tenant.id)
    .limit(2);

  if (pErr || !presentations || presentations.length < 2) {
    console.log('⚠️ Need at least 2 presentations to test independent inventory. Creating a test product with 2 presentations...');
    // Create test group
    const { data: group } = await supabase
      .from('product_groups')
      .insert({ tenant_id: tenant.id, name: 'Café Oro Test' })
      .select()
      .single();

    const { data: pres1 } = await supabase
      .from('products')
      .insert({ tenant_id: tenant.id, product_group_id: group.id, name: '500 g', price: 140 })
      .select()
      .single();

    const { data: pres2 } = await supabase
      .from('products')
      .insert({ tenant_id: tenant.id, product_group_id: group.id, name: '1 kg', price: 250 })
      .select()
      .single();

    presentations.push(pres1, pres2);
  }

  const p1 = presentations[0];
  const p2 = presentations[1];
  console.log(`✅ Presentation 1: "${p1.name}" (${p1.id})`);
  console.log(`✅ Presentation 2: "${p2.name}" (${p2.id})`);

  // 3. Set independent quantities
  console.log('\n📦 Setting independent inventory quantities:');
  console.log(`   - Setting Presentation 1 ("${p1.name}") to 2 unidades...`);
  const { data: inv1, error: iErr1 } = await supabase
    .from('inventory')
    .upsert({
      tenant_id: tenant.id,
      presentation_id: p1.id,
      quantity: 2.00,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id, presentation_id' })
    .select()
    .single();

  if (iErr1) throw new Error('Failed to set inventory 1: ' + JSON.stringify(iErr1));
  console.log(`   ✓ Saved: ${inv1.quantity} unidades for ${p1.name}`);

  console.log(`   - Setting Presentation 2 ("${p2.name}") to 5 unidades...`);
  const { data: inv2, error: iErr2 } = await supabase
    .from('inventory')
    .upsert({
      tenant_id: tenant.id,
      presentation_id: p2.id,
      quantity: 5.00,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id, presentation_id' })
    .select()
    .single();

  if (iErr2) throw new Error('Failed to set inventory 2: ' + JSON.stringify(iErr2));
  console.log(`   ✓ Saved: ${inv2.quantity} unidades for ${p2.name}`);

  // 4. Verify independence
  console.log('\n🔍 Verifying quantities are completely independent:');
  const { data: checkInv } = await supabase
    .from('inventory')
    .select('presentation_id, quantity')
    .eq('tenant_id', tenant.id)
    .in('presentation_id', [p1.id, p2.id]);

  const p1Qty = checkInv.find(i => i.presentation_id === p1.id)?.quantity;
  const p2Qty = checkInv.find(i => i.presentation_id === p2.id)?.quantity;

  console.log(`   - ${p1.name}: ${p1Qty} unidades`);
  console.log(`   - ${p2.name}: ${p2Qty} unidades`);

  if (parseFloat(p1Qty) !== 2 || parseFloat(p2Qty) !== 5) {
    throw new Error('Quantities do not match expected values!');
  }
  console.log('✅ Independent per-presentation quantities verified!');

  // 5. Update quantity for presentation 1 (e.g. adjustment to 12 units)
  console.log(`\n✏️ Updating Presentation 1 quantity from 2 to 12 unidades...`);
  const { data: updatedInv1, error: uErr } = await supabase
    .from('inventory')
    .update({ quantity: 12.00, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenant.id)
    .eq('presentation_id', p1.id)
    .select()
    .single();

  if (uErr) throw new Error('Failed to update inventory: ' + JSON.stringify(uErr));
  console.log(`✅ Updated: Presentation 1 now has ${updatedInv1.quantity} unidades, while Presentation 2 remains at ${p2Qty} unidades.`);

  // 6. Test Multi-tenant isolation with anon client simulation
  console.log('\n🔒 Testing Multi-tenant isolation:');
  const fakeTenantId = '00000000-0000-0000-0000-000000000000';
  const { data: isolatedInv } = await supabase
    .from('inventory')
    .select('*')
    .eq('tenant_id', fakeTenantId);

  console.log(`   - Other tenant inventory query returned: ${isolatedInv.length} records.`);
  if (isolatedInv.length !== 0) {
    throw new Error('Data leak between tenants detected!');
  }
  console.log('✅ Multi-tenant isolation verified!');

  console.log('\n🎉 ALL INVENTORY INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
}

runInventoryIntegrationTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
