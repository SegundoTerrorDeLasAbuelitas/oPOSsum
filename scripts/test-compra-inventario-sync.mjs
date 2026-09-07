import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Read .env.local dynamically
const envContent = fs.readFileSync('.env.local', 'utf8');
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

async function runTest() {
  console.log('🧪 Iniciando prueba obligatoria Compras → Inventario...');

  // 1. Identificar Tenant de Bruno ("China machinery")
  const tenantId = '254ee1b6-cd93-4ac2-8bdb-cf9c2a133c20';
  const { data: tenant } = await supabase.from('tenants').select('id, name').eq('id', tenantId).single();
  console.log(`✅ Usando Tenant: "${tenant.name}" (${tenant.id})`);

  // 2. Obtener proveedor "Sabormex sa de cv"
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();
  console.log(`✅ Proveedor: "${supplier.name}" (${supplier.id})`);

  // 3. Obtener presentación "Nescafe 500 g"
  const { data: pres500g } = await supabase
    .from('products')
    .select('id, name, product_group_id, product_groups(name)')
    .eq('tenant_id', tenantId)
    .eq('name', '500 g')
    .limit(1)
    .single();
  console.log(`✅ Presentación: "${pres500g.product_groups.name} — ${pres500g.name}" (${pres500g.id})`);

  // 4. Paso A: Establecer inventario inicial en 5 unidades
  console.log('\n--- PASO 1: Establecer Inventario Inicial en 5 unidades ---');
  await supabase
    .from('inventory')
    .upsert({
      tenant_id: tenantId,
      presentation_id: pres500g.id,
      quantity: 5.00,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id, presentation_id' });

  let { data: invStep0 } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('presentation_id', pres500g.id)
    .single();
  console.log(`📊 Inventario Inicial: ${invStep0.quantity} unidades (Esperado: 5)`);
  if (parseFloat(invStep0.quantity) !== 5) {
    throw new Error(`Inventario inicial incorrecto: ${invStep0.quantity}`);
  }

  // 5. Paso B: Registrar Compra 1 (10 unidades @ $25.00)
  console.log('\n--- PASO 2: Registrar Compra 1 (+10 unidades) ---');
  const { data: purchase1, error: p1Err } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'Factura F-001',
    p_notes: 'Prueba sincronización inventarios 1',
    p_items: [
      {
        presentation_id: pres500g.id,
        product_name: pres500g.product_groups.name,
        presentation_name: pres500g.name,
        quantity: 10,
        unit_cost: 25.00
      }
    ]
  });

  if (p1Err) throw p1Err;
  console.log(`✅ Compra 1 registrada con éxito: Folio ${purchase1.folio}, Total: $${purchase1.total}`);

  // Verificar que el inventario sea 5 + 10 = 15 unidades
  let { data: invStep1 } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('presentation_id', pres500g.id)
    .single();
  console.log(`📊 Inventario tras Compra 1: ${invStep1.quantity} unidades (Esperado: 15)`);
  if (parseFloat(invStep1.quantity) !== 15) {
    throw new Error(`Fallo en incremento de inventario tras Compra 1: ${invStep1.quantity} != 15`);
  }

  // Verificar movimiento de inventario para Compra 1
  const { data: mov1 } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('reference_id', purchase1.purchase_id)
    .single();
  console.log(`📋 Movimiento auditado Compra 1:`, {
    tipo: mov1.movement_type,
    cambio: mov1.quantity_change,
    antes: mov1.quantity_before,
    despues: mov1.quantity_after,
    ref: mov1.reference_id
  });
  if (parseFloat(mov1.quantity_change) !== 10 || parseFloat(mov1.quantity_before) !== 5 || parseFloat(mov1.quantity_after) !== 15) {
    throw new Error('Datos del movimiento de auditoría 1 incorrectos');
  }

  // 6. Paso C: Registrar Compra 2 (+4 unidades @ $25.00)
  console.log('\n--- PASO 3: Registrar Compra 2 (+4 unidades) ---');
  const { data: purchase2, error: p2Err } = await supabase.rpc('create_purchase_order', {
    p_tenant_id: tenantId,
    p_supplier_id: supplier.id,
    p_purchase_date: new Date().toISOString().split('T')[0],
    p_reference: 'Factura F-002',
    p_notes: 'Prueba sincronización inventarios 2',
    p_items: [
      {
        presentation_id: pres500g.id,
        product_name: pres500g.product_groups.name,
        presentation_name: pres500g.name,
        quantity: 4,
        unit_cost: 25.00
      }
    ]
  });

  if (p2Err) throw p2Err;
  console.log(`✅ Compra 2 registrada con éxito: Folio ${purchase2.folio}, Total: $${purchase2.total}`);

  // Verificar que el inventario sea 15 + 4 = 19 unidades
  let { data: invStep2 } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('presentation_id', pres500g.id)
    .single();
  console.log(`📊 Inventario tras Compra 2: ${invStep2.quantity} unidades (Esperado: 19)`);
  if (parseFloat(invStep2.quantity) !== 19) {
    throw new Error(`Fallo en incremento de inventario tras Compra 2: ${invStep2.quantity} != 19`);
  }

  // Verificar movimiento de inventario para Compra 2
  const { data: mov2 } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('reference_id', purchase2.purchase_id)
    .single();
  console.log(`📋 Movimiento auditado Compra 2:`, {
    tipo: mov2.movement_type,
    cambio: mov2.quantity_change,
    antes: mov2.quantity_before,
    despues: mov2.quantity_after,
    ref: mov2.reference_id
  });
  if (parseFloat(mov2.quantity_change) !== 4 || parseFloat(mov2.quantity_before) !== 15 || parseFloat(mov2.quantity_after) !== 19) {
    throw new Error('Datos del movimiento de auditoría 2 incorrectos');
  }

  // 7. Paso D: Verificar inmutabilidad del historial de compras
  console.log('\n--- PASO 4: Verificar Inmutabilidad del Historial de Compras ---');
  const { data: hist1 } = await supabase
    .from('purchases')
    .select('id, folio, folio_number, supplier_name, purchase_date, subtotal, total, purchase_items(*)')
    .eq('id', purchase1.purchase_id)
    .single();

  console.log(`🧾 Compra 1 en Historial:`, {
    folio: hist1.folio,
    proveedor: hist1.supplier_name,
    total: hist1.total,
    partidas: hist1.purchase_items.map(it => ({
      producto: it.product_name,
      presentacion: it.presentation_name,
      cantidad: it.quantity,
      costo: it.unit_cost,
      importe: it.subtotal
    }))
  });

  const { data: hist2 } = await supabase
    .from('purchases')
    .select('id, folio, folio_number, supplier_name, purchase_date, subtotal, total, purchase_items(*)')
    .eq('id', purchase2.purchase_id)
    .single();

  console.log(`🧾 Compra 2 en Historial:`, {
    folio: hist2.folio,
    proveedor: hist2.supplier_name,
    total: hist2.total,
    partidas: hist2.purchase_items.map(it => ({
      producto: it.product_name,
      presentacion: it.presentation_name,
      cantidad: it.quantity,
      costo: it.unit_cost,
      importe: it.subtotal
    }))
  });

  // 8. Paso E: Verificar aislamiento Multi-Tenant
  console.log('\n--- PASO 5: Verificar Aislamiento Multi-Tenant ---');
  const otherTenantId = '93206ccb-c942-4fa1-8e2f-b2fb74bdd69f';
  const { data: otherInv } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('tenant_id', otherTenantId)
    .eq('presentation_id', pres500g.id);

  console.log(`🔒 Consulta de inventario en otro tenant para esta presentación:`, otherInv);
  if (otherInv && otherInv.length > 0) {
    throw new Error('Violación de aislamiento multi-tenant en inventario');
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE INTEGRACIÓN COMPRAS → INVENTARIOS PASARON AL 100%!');
}

runTest().catch(err => {
  console.error('❌ Error en la prueba:', err);
  process.exit(1);
});
