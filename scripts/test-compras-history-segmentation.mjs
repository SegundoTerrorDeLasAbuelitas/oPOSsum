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

async function runComprasSegmentationTest() {
  console.log('🧪 Running Purchases History Segmentation & Anti-Duplication Test...\n');

  // 1. Tenant
  const { data: tenants, error: tErr } = await supabase.from('tenants').select('id, name').limit(1);
  if (tErr || !tenants || tenants.length === 0) throw new Error('No tenant found.');
  const tenantId = tenants[0].id;
  console.log(`✅ Using Tenant: "${tenants[0].name}" (${tenantId})`);

  // 2. Create two categories
  const timestamp = Date.now();
  const { data: catA, error: cAErr } = await supabase.from('categories').insert({
    tenant_id: tenantId,
    name: `Cat A Segment Test ${timestamp}`
  }).select().single();
  if (cAErr) throw new Error(`Cat A failed: ${cAErr.message}`);

  const { data: catB, error: cBErr } = await supabase.from('categories').insert({
    tenant_id: tenantId,
    name: `Cat B Segment Test ${timestamp}`
  }).select().single();
  if (cBErr) throw new Error(`Cat B failed: ${cBErr.message}`);

  console.log(`✅ Categories created: "${catA.name}" and "${catB.name}"`);

  // 3. Create two suppliers
  const { data: suppA, error: sAErr } = await supabase.from('suppliers').insert({
    tenant_id: tenantId,
    name: `Proveedor Segment Alfa ${timestamp}`
  }).select().single();
  if (sAErr) throw new Error(`Supplier A failed: ${sAErr.message}`);

  const { data: suppB, error: sBErr } = await supabase.from('suppliers').insert({
    tenant_id: tenantId,
    name: `Proveedor Segment Beta ${timestamp}`
  }).select().single();
  if (sBErr) throw new Error(`Supplier B failed: ${sBErr.message}`);

  console.log(`✅ Suppliers created: "${suppA.name}" and "${suppB.name}"`);

  // 4. Create product groups and presentations for each category
  const { data: grpA, error: gAErr } = await supabase.from('product_groups').insert({
    tenant_id: tenantId,
    category_id: catA.id,
    name: `Producto Alfa ${timestamp}`
  }).select().single();
  if (gAErr) throw new Error(`Group A failed: ${gAErr.message}`);

  const { data: presA1 } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: grpA.id,
    name: 'Pres Alfa 1',
    price: 100
  }).select().single();

  const { data: presA2 } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: grpA.id,
    name: 'Pres Alfa 2',
    price: 150
  }).select().single();

  const { data: grpB, error: gBErr } = await supabase.from('product_groups').insert({
    tenant_id: tenantId,
    category_id: catB.id,
    name: `Producto Beta ${timestamp}`
  }).select().single();
  if (gBErr) throw new Error(`Group B failed: ${gBErr.message}`);

  const { data: presB1 } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: grpB.id,
    name: 'Pres Beta 1',
    price: 200
  }).select().single();

  console.log('✅ Products and presentations setup completed');

  // 5. Create Purchases using production create_purchase_order RPC:
  // Purchase 1: Has Supplier Alfa, Contains presA1 and presA2 (both in Category A)
  const { data: p1Res, error: p1Err } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: suppA.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'REF-A-001',
    p_notes: 'Prueba compra 1',
    p_items: [
      {
        presentation_id: presA1.id,
        product_name: grpA.name,
        presentation_name: presA1.name,
        quantity: 2,
        unit_cost: 100
      },
      {
        presentation_id: presA2.id,
        product_name: grpA.name,
        presentation_name: presA2.name,
        quantity: 2,
        unit_cost: 150
      }
    ]
  });
  if (p1Err) throw new Error(`create_purchase_order 1 failed: ${p1Err.message}`);
  const p1 = { id: p1Res.purchase_id, ...p1Res };

  // Purchase 2: Has Supplier Beta, Contains presB1 (in Category B) and presA1 (in Category A)
  const { data: p2Res, error: p2Err } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: suppB.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'REF-B-002',
    p_notes: 'Prueba compra 2 mixta',
    p_items: [
      {
        presentation_id: presB1.id,
        product_name: grpB.name,
        presentation_name: presB1.name,
        quantity: 1,
        unit_cost: 200
      },
      {
        presentation_id: presA1.id,
        product_name: grpA.name,
        presentation_name: presA1.name,
        quantity: 1,
        unit_cost: 100
      }
    ]
  });
  if (p2Err) throw new Error(`create_purchase_order 2 failed: ${p2Err.message}`);
  const p2 = { id: p2Res.purchase_id, ...p2Res };

  // Purchase 3: No supplier (Sin proveedor), Contains only presB1 (Category B)
  const { data: p3Res, error: p3Err } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: null,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'REF-NONE-003',
    p_notes: 'Prueba compra 3 sin proveedor',
    p_items: [
      {
        presentation_id: presB1.id,
        product_name: grpB.name,
        presentation_name: presB1.name,
        quantity: 1,
        unit_cost: 200
      }
    ]
  });
  if (p3Err) throw new Error(`create_purchase_order 3 failed: ${p3Err.message}`);
  const p3 = { id: p3Res.purchase_id, ...p3Res };

  console.log('✅ Created 3 test purchases (P1: Cat A only; P2: Cat A & B mixed; P3: Cat B only & sin proveedor)');

  // 6. Test Query structure as defined in purchasesManager.getPurchasesHistory()
  const { data: purchases, error: qErr } = await supabase
    .from('purchases')
    .select(`
      id,
      folio,
      supplier_id,
      supplier_name,
      purchase_date,
      reference,
      total,
      status,
      notes,
      created_at,
      purchase_items (
        id,
        presentation_id,
        product_name,
        presentation_name,
        quantity,
        unit_cost,
        subtotal,
        products (
          id,
          product_group_id,
          product_groups (
            id,
            name,
            category_id,
            categories (
              id,
              name
            )
          )
        )
      )
    `)
    .eq('tenant_id', tenantId)
    .in('id', [p1.id, p2.id, p3.id])
    .order('created_at', { ascending: false });

  if (qErr) throw new Error(`Query failed: ${qErr.message}`);
  console.log(`✅ Loaded ${purchases.length} purchases with nested product & category join`);

  // 7. Verify segmentation filtering logic
  
  // A. General mode
  console.log('\n--- Mode: General ---');
  console.log(`General returns all: ${purchases.length === 3 ? 'PASS ✅' : 'FAIL ❌'}`);

  // B. Category A segmentation
  console.log('\n--- Mode: Por Categoría (Cat A) ---');
  const catAFiltered = purchases.filter(p => 
    (p.purchase_items || []).some(item => item.products?.product_groups?.category_id === catA.id)
  );
  console.log(`Purchases matching Cat A: ${catAFiltered.map(p => p.folio).join(', ')}`);
  // P1 and P2 match. P1 has two items in Cat A, P2 has one. Anti-duplication check:
  const p1Occurrences = catAFiltered.filter(p => p.id === p1.id).length;
  console.log(`P1 occurrences in Cat A (must be 1): ${p1Occurrences}`);
  if (p1Occurrences !== 1 || catAFiltered.length !== 2) {
    throw new Error(`Cat A segmentation failed! Expected 2 unique purchases, got ${catAFiltered.length}`);
  }
  console.log('Cat A segmentation & Anti-duplication: PASS ✅');

  // C. Category B segmentation
  console.log('\n--- Mode: Por Categoría (Cat B) ---');
  const catBFiltered = purchases.filter(p => 
    (p.purchase_items || []).some(item => item.products?.product_groups?.category_id === catB.id)
  );
  console.log(`Purchases matching Cat B: ${catBFiltered.map(p => p.folio).join(', ')}`);
  if (catBFiltered.length !== 2 || !catBFiltered.some(p => p.id === p2.id) || !catBFiltered.some(p => p.id === p3.id)) {
    throw new Error('Cat B segmentation failed! Expected P2 and P3');
  }
  console.log('Cat B segmentation: PASS ✅');

  // D. Supplier segmentation
  console.log('\n--- Mode: Por Proveedor ---');
  const suppAFiltered = purchases.filter(p => p.supplier_id === suppA.id);
  console.log(`Purchases for Supplier Alfa (expected P1 only): ${suppAFiltered.map(p => p.folio).join(', ')}`);
  if (suppAFiltered.length !== 1 || suppAFiltered[0].id !== p1.id) {
    throw new Error('Supplier Alfa segmentation failed');
  }
  console.log('Supplier Alfa segmentation: PASS ✅');

  const sinProveedorFiltered = purchases.filter(p => !p.supplier_id || p.supplier_name === 'Proveedor sin registrar');
  console.log(`Purchases for Sin Proveedor (expected P3 only): ${sinProveedorFiltered.map(p => p.folio).join(', ')}`);
  if (sinProveedorFiltered.length !== 1 || sinProveedorFiltered[0].id !== p3.id) {
    throw new Error('Sin Proveedor segmentation failed');
  }
  console.log('Sin Proveedor segmentation: PASS ✅');

  // E. Live search query filter
  console.log('\n--- Search Query Filter ---');
  const qNotes = 'mixta';
  const notesMatch = purchases.filter(p => (p.notes || '').toLowerCase().includes(qNotes));
  if (notesMatch.length !== 1 || notesMatch[0].id !== p2.id) {
    throw new Error('Search by note failed');
  }
  console.log('Search by note: PASS ✅');

  const qItem = 'pres alfa 2';
  const itemMatch = purchases.filter(p => (p.purchase_items || []).some(it => (it.presentation_name || '').toLowerCase().includes(qItem)));
  if (itemMatch.length !== 1 || itemMatch[0].id !== p1.id) {
    throw new Error('Search by item name failed');
  }
  console.log('Search by item name: PASS ✅');

  console.log('\n🎉 ALL COMPRAS HISTORY SEGMENTATION TESTS PASSED PERFECTLY!\n');
}

runComprasSegmentationTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
