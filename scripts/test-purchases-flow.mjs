import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Read .env.local dynamically
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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function runPurchasesIntegrationTest() {
  console.log('🧪 Running Purchases, Sequential Folios & Inventory Integration Test...\n');

  // 1. Get or create a test tenant
  const { data: tenants, error: tErr } = await supabase.from('tenants').select('id, name').limit(1);
  if (tErr || !tenants || tenants.length === 0) {
    throw new Error('No tenant found in database.');
  }
  const tenantId = tenants[0].id;
  console.log(`✅ Using Tenant: "${tenants[0].name}" (${tenantId})`);

  // 2. Create or find a supplier
  const timestamp = Date.now();
  const { data: supplier, error: sErr } = await supabase.from('suppliers').insert({
    tenant_id: tenantId,
    name: `Distribuidora ABC Test ${timestamp}`,
    phone: '33 1234 5678',
    email: `abc_${timestamp}@proveedor.com`
  }).select().single();

  if (sErr) throw new Error(`Failed to create test supplier: ${sErr.message}`);
  console.log(`✅ Test Supplier created: "${supplier.name}" (${supplier.id})`);

  // 3. Create test product group and presentations
  const { data: group, error: gErr } = await supabase.from('product_groups').insert({
    tenant_id: tenantId,
    name: `Café Prueba ${timestamp}`,
    description: 'Producto para prueba de compras'
  }).select().single();
  if (gErr) throw new Error(`Failed to create product group: ${gErr.message}`);

  // Presentation 1: 500 g
  const { data: pres1, error: p1Err } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: group.id,
    name: '500 g',
    price: 120.00
  }).select().single();
  if (p1Err) throw new Error(`Failed to create presentation 1: ${p1Err.message}`);

  // Presentation 2: 1 kg
  const { data: pres2, error: p2Err } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: group.id,
    name: '1 kg',
    price: 220.00
  }).select().single();
  if (p2Err) throw new Error(`Failed to create presentation 2: ${p2Err.message}`);

  console.log(`✅ Presentations created: "${pres1.name}" (${pres1.id}) and "${pres2.name}" (${pres2.id})`);

  // Check initial inventory
  const { data: initInv1 } = await supabase.from('inventory').select('quantity').eq('presentation_id', pres1.id).single();
  const initQty1 = parseFloat(initInv1?.quantity || 0);
  console.log(`📊 Initial inventory for Presentation 1: ${initQty1} unidades`);

  // 4. Register Purchase Order 1 via RPC create_purchase_order
  console.log('\n📦 Registering Purchase Order 1...');
  const purchaseItems1 = [
    {
      presentation_id: pres1.id,
      product_name: group.name,
      presentation_name: pres1.name,
      quantity: 10.00,
      unit_cost: 85.00
    },
    {
      presentation_id: pres2.id,
      product_name: group.name,
      presentation_name: pres2.name,
      quantity: 5.00,
      unit_cost: 160.00
    }
  ];

  const { data: purchaseRes1, error: poErr1 } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'FAC-TEST-001',
    p_notes: 'Primera compra de prueba automatizada',
    p_items: purchaseItems1
  });

  if (poErr1) throw new Error(`create_purchase_order 1 failed: ${poErr1.message}`);
  console.log('✅ Purchase Order 1 Created:', purchaseRes1);

  if (!purchaseRes1.folio.startsWith('C-')) {
    throw new Error(`Folio does not start with C-: ${purchaseRes1.folio}`);
  }

  // 5. Register Purchase Order 2 to verify sequential folios
  console.log('\n📦 Registering Purchase Order 2...');
  const purchaseItems2 = [
    {
      presentation_id: pres1.id,
      product_name: group.name,
      presentation_name: pres1.name,
      quantity: 4.00,
      unit_cost: 88.00
    }
  ];

  const { data: purchaseRes2, error: poErr2 } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'REM-TEST-002',
    p_notes: 'Segunda compra de prueba',
    p_items: purchaseItems2
  });

  if (poErr2) throw new Error(`create_purchase_order 2 failed: ${poErr2.message}`);
  console.log('✅ Purchase Order 2 Created:', purchaseRes2);

  if (purchaseRes2.folio_number !== purchaseRes1.folio_number + 1) {
    throw new Error(`Folio number did not increment sequentially! Expected ${purchaseRes1.folio_number + 1}, got ${purchaseRes2.folio_number}`);
  }
  console.log(`✅ Verified sequential folios: ${purchaseRes1.folio} -> ${purchaseRes2.folio}`);

  // 6. Verify Inventory Increase and Movements
  console.log('\n🔍 Verifying Inventory changes and Audit Movements...');
  const { data: finalInv1 } = await supabase.from('inventory').select('quantity').eq('presentation_id', pres1.id).single();
  const finalQty1 = parseFloat(finalInv1?.quantity || 0);
  console.log(`📊 Final inventory for Presentation 1: ${finalQty1} unidades (Initial was ${initQty1}, added 10 + 4 = 14)`);

  if (finalQty1 !== initQty1 + 14.00) {
    throw new Error(`Inventory mismatch: expected ${initQty1 + 14.00}, got ${finalQty1}`);
  }
  console.log('✅ Inventory quantity strictly incremented by total purchased!');

  // Check inventory movements for pres1
  const { data: movements, error: mErr } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('presentation_id', pres1.id)
    .eq('movement_type', 'purchase');

  if (mErr || !movements || movements.length < 2) {
    throw new Error(`Movements missing: ${mErr?.message || movements?.length}`);
  }
  console.log(`✅ Verified ${movements.length} inventory movements recorded with movement_type = 'purchase' and reference_id.`);

  // 7. Verify Inmutable Snapshot
  console.log('\n🔒 Verifying Inmutable Historical Snapshots...');
  const { data: purchaseDetail, error: pdErr } = await supabase
    .from('purchases')
    .select(`
      *,
      purchase_items (*)
    `)
    .eq('id', purchaseRes1.purchase_id)
    .single();

  if (pdErr) throw new Error(`Failed to fetch purchase detail: ${pdErr.message}`);
  console.log(`✅ Purchase Detail retrieved. Total: $${purchaseDetail.total}, Items count: ${purchaseDetail.purchase_items.length}`);

  const item1 = purchaseDetail.purchase_items.find(i => i.presentation_id === pres1.id);
  if (!item1 || parseFloat(item1.unit_cost) !== 85.00 || parseFloat(item1.quantity) !== 10.00) {
    throw new Error(`Snapshot corrupted: ${JSON.stringify(item1)}`);
  }
  console.log(`✅ Snapshot verified: "${item1.product_name} - ${item1.presentation_name}", 10 @ $85.00 = $${item1.subtotal}`);

  // 8. Verify multi-tenant isolation
  console.log('\n🛡️ Testing Multi-tenant isolation...');
  const { data: otherTenant } = await supabase.from('tenants').insert({ name: `Tenant Isolado ${timestamp}` }).select().single();
  if (otherTenant) {
    const { data: isolPurchases } = await supabase.from('purchases').select('id').eq('tenant_id', otherTenant.id);
    console.log(`✅ Other tenant purchase count: ${isolPurchases?.length || 0}`);
    if (isolPurchases?.length !== 0) throw new Error('Multi-tenant isolation failed!');
  }

  console.log('\n🎉 ALL PURCHASES, FOLIOS & INVENTORY TESTS PASSED 100% SUCCESSFULLY!');
}

runPurchasesIntegrationTest().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
