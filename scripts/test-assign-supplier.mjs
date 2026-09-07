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

async function runAssignSupplierIntegrationTest() {
  console.log('🧪 Running Assign Supplier & Multi-Supplier Integration Test...\n');

  // 1. Get test tenant
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, name')
    .limit(1)
    .single();

  if (tErr || !tenant) {
    throw new Error('No test tenant found');
  }
  console.log(`✅ Using Tenant: "${tenant.name}" (${tenant.id})`);

  // 2. Create product group and a presentation with NO supplier
  const { data: group, error: gErr } = await supabase
    .from('product_groups')
    .insert({ tenant_id: tenant.id, name: 'Café Oro Test ' + Date.now() })
    .select()
    .single();

  if (gErr) throw new Error('Failed to create group: ' + JSON.stringify(gErr));

  const originalPrice = 150.00;
  const { data: presentation, error: pErr } = await supabase
    .from('products')
    .insert({
      tenant_id: tenant.id,
      product_group_id: group.id,
      name: '500 g',
      price: originalPrice
    })
    .select()
    .single();

  if (pErr) throw new Error('Failed to create presentation: ' + JSON.stringify(pErr));
  console.log(`✅ Created presentation without supplier: "${group.name} - ${presentation.name}" (Price: $${presentation.price})`);

  // Verify 0 supplier presentations
  const { data: initialSuppRels } = await supabase
    .from('supplier_presentations')
    .select('*')
    .eq('product_id', presentation.id);

  if (initialSuppRels.length !== 0) {
    throw new Error('Expected 0 suppliers initially!');
  }
  console.log('✅ Confirmed presentation starts with 0 suppliers.');

  // 3. Create two distinct suppliers
  const { data: supp1 } = await supabase
    .from('suppliers')
    .insert({ tenant_id: tenant.id, name: 'Distribuidora ABC ' + Date.now(), phone: '3311223344' })
    .select()
    .single();

  const { data: supp2 } = await supabase
    .from('suppliers')
    .insert({ tenant_id: tenant.id, name: 'Proveedor XYZ ' + Date.now(), email: 'xyz@test.com' })
    .select()
    .single();

  console.log(`✅ Supplier 1: "${supp1.name}" (${supp1.id})`);
  console.log(`✅ Supplier 2: "${supp2.name}" (${supp2.id})`);

  // 4. Assign Supplier 1 with cost $100.00
  console.log('\n📦 Assigning Supplier 1 with cost $100.00...');
  const { data: rel1, error: r1Err } = await supabase
    .from('supplier_presentations')
    .upsert({
      tenant_id: tenant.id,
      product_id: presentation.id,
      supplier_id: supp1.id,
      last_purchase_cost: 100.00,
      updated_at: new Date().toISOString()
    }, { onConflict: 'supplier_id, product_id' })
    .select()
    .single();

  if (r1Err) throw new Error('Failed to assign Supplier 1: ' + JSON.stringify(r1Err));
  console.log(`✅ Assigned Supplier 1: Cost $${rel1.last_purchase_cost}`);

  // 5. Assign Supplier 2 with cost $95.00 to the SAME presentation
  console.log('\n📦 Assigning Supplier 2 with cost $95.00 to the same presentation...');
  const { data: rel2, error: r2Err } = await supabase
    .from('supplier_presentations')
    .upsert({
      tenant_id: tenant.id,
      product_id: presentation.id,
      supplier_id: supp2.id,
      last_purchase_cost: 95.00,
      updated_at: new Date().toISOString()
    }, { onConflict: 'supplier_id, product_id' })
    .select()
    .single();

  if (r2Err) throw new Error('Failed to assign Supplier 2: ' + JSON.stringify(r2Err));
  console.log(`✅ Assigned Supplier 2: Cost $${rel2.last_purchase_cost}`);

  // 6. Verify that BOTH relationships exist with independent costs
  const { data: allRels } = await supabase
    .from('supplier_presentations')
    .select('supplier_id, last_purchase_cost, suppliers(name)')
    .eq('product_id', presentation.id);

  console.log(`\n🔍 Verifying all supplier relationships for presentation:`);
  allRels.forEach(r => {
    console.log(`   - ${r.suppliers?.name}: Cost $${r.last_purchase_cost}`);
  });

  if (allRels.length !== 2) {
    throw new Error(`Expected 2 suppliers, found ${allRels.length}`);
  }

  const cost1 = allRels.find(r => r.supplier_id === supp1.id)?.last_purchase_cost;
  const cost2 = allRels.find(r => r.supplier_id === supp2.id)?.last_purchase_cost;

  if (parseFloat(cost1) !== 100.00 || parseFloat(cost2) !== 95.00) {
    throw new Error('Costs do not match expected values ($100.00 and $95.00)!');
  }

  // 7. Verify presentation sale price remains intact
  const { data: presCheck } = await supabase
    .from('products')
    .select('price')
    .eq('id', presentation.id)
    .single();

  console.log(`\n💰 Checking presentation retail price: $${presCheck.price} (Original was $${originalPrice})`);
  if (parseFloat(presCheck.price) !== originalPrice) {
    throw new Error('Retail price was modified! Expected $150.00');
  }
  console.log('✅ Retail price remained completely untouched!');

  console.log('\n🎉 ALL ASSIGN SUPPLIER INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
}

runAssignSupplierIntegrationTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
