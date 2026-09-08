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

const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function getMovementPeriodKey(dateStr, fallbackCreatedStr) {
  const d = dateStr || (fallbackCreatedStr ? fallbackCreatedStr.split('T')[0] : '');
  if (!d) return 'unknown';
  const parts = d.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return 'unknown';
}

function formatPeriodLabel(periodKey) {
  if (!periodKey || periodKey === 'unknown') return 'Sin periodo';
  const parts = periodKey.split('-');
  if (parts.length < 2) return periodKey;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthName = SPANISH_MONTHS[monthIdx] || parts[1];
  return `${monthName} ${year}`;
}

async function runMovementPeriodsTest() {
  console.log('🧪 Running Movement Dates & Monthly Grouping Integration Test (Compras & Ventas)...\n');

  // 1. Sign up / in a test user
  const email = `testuser_periods_${Date.now()}@example.com`;
  const password = 'Password123!';
  const { data: authData, error: aErr } = await supabase.auth.signUp({ email, password });
  if (aErr) throw new Error(`Auth sign up failed: ${aErr.message}`);

  // Create tenant with owner
  const { data: tenantData, error: tErr } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Minisuper Periodos Test',
    p_slug: `minisuper-periodos-${Date.now()}`,
    p_business_type: 'Tienda de Abarrotes'
  });
  if (tErr) throw new Error(`Tenant creation failed: ${tErr.message}`);
  const tenantId = tenantData.tenant_id;
  console.log(`✅ Tenant created and authenticated: "${tenantData.tenant_name || 'Minisuper Periodos'}" (${tenantId})`);

  // 2. Setup Supplier and Product
  const timestamp = Date.now();
  const { data: supplier, error: sErr } = await supabase.from('suppliers').insert({
    tenant_id: tenantId,
    name: `Proveedor Periodos ${timestamp}`
  }).select().single();
  if (sErr) throw new Error(`Supplier failed: ${sErr.message}`);

  const { data: group, error: gErr } = await supabase.from('product_groups').insert({
    tenant_id: tenantId,
    name: `Producto Periodos ${timestamp}`
  }).select().single();
  if (gErr) throw new Error(`Product group failed: ${gErr.message}`);

  const { data: pres, error: pErr } = await supabase.from('products').insert({
    tenant_id: tenantId,
    product_group_id: group.id,
    name: 'Presentación 250 g',
    price: 150.00
  }).select().single();
  if (pErr) throw new Error(`Presentation failed: ${pErr.message}`);

  console.log('✅ Test product and supplier registered');

  // 3. Register Historical Purchase: Mayo 2026 (2026-05-15)
  console.log('\n--- 1. Testing Purchases by Movement Date ---');
  const { data: pMayRes, error: pMayErr } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: '2026-05-15',
    p_reference: 'FAC-MAY-2026',
    p_notes: 'Compra histórica de Mayo',
    p_items: [
      {
        presentation_id: pres.id,
        product_name: group.name,
        presentation_name: pres.name,
        quantity: 10,
        unit_cost: 90
      }
    ]
  });
  if (pMayErr) throw new Error(`May purchase failed: ${pMayErr.message}`);
  console.log(`✅ Mayo purchase registered: Folio ${pMayRes.folio}, Date: 2026-05-15, Total: $${pMayRes.subtotal}`);

  // 4. Register Current Purchase: Septiembre 2026 (2026-09-08)
  const { data: pSepRes, error: pSepErr } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: '2026-09-08',
    p_reference: 'FAC-SEP-2026',
    p_notes: 'Compra de Septiembre',
    p_items: [
      {
        presentation_id: pres.id,
        product_name: group.name,
        presentation_name: pres.name,
        quantity: 5,
        unit_cost: 95
      }
    ]
  });
  if (pSepErr) throw new Error(`Sep purchase failed: ${pSepErr.message}`);
  console.log(`✅ Septiembre purchase registered: Folio ${pSepRes.folio}, Date: 2026-09-08, Total: $${pSepRes.subtotal}`);

  // 5. Register Historical Sale: Mayo 2026 (2026-05-20)
  console.log('\n--- 2. Testing Sales by Movement Date ---');
  const { data: sMayRes, error: sMayErr } = await supabase.rpc('create_sale_checkout', {
    p_tenant_id: tenantId,
    p_customer_name: 'Cliente Mayo Histórico',
    p_items: [
      {
        product_id: pres.id,
        product_name: `${group.name} - ${pres.name}`,
        quantity: 2,
        unit_price: 150
      }
    ],
    p_discount_amount: 0,
    p_payment_method: 'cash',
    p_sale_date: '2026-05-20'
  });
  if (sMayErr) throw new Error(`May sale failed: ${sMayErr.message}`);
  console.log(`✅ Mayo sale registered: Folio ${sMayRes.folio}, Date: ${sMayRes.sale_date}, Total: $${sMayRes.total}`);

  // 6. Register Current Sale: Septiembre 2026 (2026-09-08)
  const { data: sSepRes, error: sSepErr } = await supabase.rpc('create_sale_checkout', {
    p_tenant_id: tenantId,
    p_customer_name: 'Cliente Septiembre',
    p_items: [
      {
        product_id: pres.id,
        product_name: `${group.name} - ${pres.name}`,
        quantity: 1,
        unit_price: 150
      }
    ],
    p_discount_amount: 0,
    p_payment_method: 'cash',
    p_sale_date: '2026-09-08'
  });
  if (sSepErr) throw new Error(`Sep sale failed: ${sSepErr.message}`);
  console.log(`✅ Septiembre sale registered: Folio ${sSepRes.folio}, Date: ${sSepRes.sale_date}, Total: $${sSepRes.total}`);

  // 7. Verify Period Determination for Purchases
  console.log('\n--- 3. Period Determination and Monthly Grouping (Compras) ---');
  const { data: purchases, error: pQErr } = await supabase
    .from('purchases')
    .select('id, folio, purchase_date, created_at, total')
    .in('id', [pMayRes.purchase_id, pSepRes.purchase_id]);

  if (pQErr) throw new Error(`Purchases query failed: ${pQErr.message}`);

  const mayPurchase = purchases.find(p => p.id === pMayRes.purchase_id);
  const sepPurchase = purchases.find(p => p.id === pSepRes.purchase_id);

  const mayPurchasePeriod = getMovementPeriodKey(mayPurchase.purchase_date, mayPurchase.created_at);
  const sepPurchasePeriod = getMovementPeriodKey(sepPurchase.purchase_date, sepPurchase.created_at);

  console.log(`May purchase period key: "${mayPurchasePeriod}" -> "${formatPeriodLabel(mayPurchasePeriod)}"`);
  console.log(`Sep purchase period key: "${sepPurchasePeriod}" -> "${formatPeriodLabel(sepPurchasePeriod)}"`);

  if (mayPurchasePeriod !== '2026-05' || formatPeriodLabel(mayPurchasePeriod) !== 'Mayo 2026') {
    throw new Error(`Expected period '2026-05' (Mayo 2026), got '${mayPurchasePeriod}'`);
  }
  if (sepPurchasePeriod !== '2026-09' || formatPeriodLabel(sepPurchasePeriod) !== 'Septiembre 2026') {
    throw new Error(`Expected period '2026-09' (Septiembre 2026), got '${sepPurchasePeriod}'`);
  }
  console.log('Purchases period determination based on purchase_date: PASS ✅');

  // 8. Verify Period Determination for Sales
  console.log('\n--- 4. Period Determination and Monthly Grouping (Ventas) ---');
  const { data: sales, error: sQErr } = await supabase
    .from('sales')
    .select('id, folio, sale_date, created_at, total')
    .in('id', [sMayRes.sale_id, sSepRes.sale_id]);

  if (sQErr) throw new Error(`Sales query failed: ${sQErr.message}`);

  const maySale = sales.find(s => s.id === sMayRes.sale_id);
  const sepSale = sales.find(s => s.id === sSepRes.sale_id);

  const maySalePeriod = getMovementPeriodKey(maySale.sale_date, maySale.created_at);
  const sepSalePeriod = getMovementPeriodKey(sepSale.sale_date, sepSale.created_at);

  console.log(`May sale period key: "${maySalePeriod}" -> "${formatPeriodLabel(maySalePeriod)}"`);
  console.log(`Sep sale period key: "${sepSalePeriod}" -> "${formatPeriodLabel(sepSalePeriod)}"`);

  if (maySalePeriod !== '2026-05' || formatPeriodLabel(maySalePeriod) !== 'Mayo 2026') {
    throw new Error(`Expected period '2026-05' (Mayo 2026), got '${maySalePeriod}'`);
  }
  if (sepSalePeriod !== '2026-09' || formatPeriodLabel(sepSalePeriod) !== 'Septiembre 2026') {
    throw new Error(`Expected period '2026-09' (Septiembre 2026), got '${sepSalePeriod}'`);
  }
  console.log('Sales period determination based on sale_date: PASS ✅');

  // 9. Verify Subtotals per Period Calculation
  console.log('\n--- 5. Subtotals per Period Validation ---');
  // Mayo Purchases
  const mayPurchasesTotal = purchases
    .filter(p => getMovementPeriodKey(p.purchase_date, p.created_at) === '2026-05')
    .reduce((sum, p) => sum + parseFloat(p.total), 0);
  console.log(`Mayo Purchases Total: $${mayPurchasesTotal} (Expected: $900)`);
  if (mayPurchasesTotal !== 900) throw new Error(`Expected $900 for Mayo purchases, got $${mayPurchasesTotal}`);

  // Mayo Sales
  const maySalesTotal = sales
    .filter(s => getMovementPeriodKey(s.sale_date, s.created_at) === '2026-05')
    .reduce((sum, s) => sum + parseFloat(s.total), 0);
  console.log(`Mayo Sales Total: $${maySalesTotal} (Expected: $300)`);
  if (maySalesTotal !== 300) throw new Error(`Expected $300 for Mayo sales, got $${maySalesTotal}`);

  console.log('Period Subtotals: PASS ✅');

  console.log('\n🎉 ALL MOVEMENT DATES & PERIOD GROUPING TESTS PASSED 100% PERFECTLY!\n');
}

runMovementPeriodsTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
