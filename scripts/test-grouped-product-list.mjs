import assert from 'node:assert';

// Mock function mirroring buildGroupedProductData from app/dashboard.html
function buildGroupedProductData(productGroups, groupBy = 'category') {
  if (!productGroups || !Array.isArray(productGroups)) return [];

  if (groupBy === 'category') {
    const categoryMap = new Map();

    productGroups.forEach(g => {
      const catId = g.category_id || 'sin-categoria';
      const catName = g.categories?.name ? g.categories.name.trim() : 'Sin categoría';

      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, {
          id: catId,
          title: catName,
          subtitle: '',
          icon: '📁',
          isWarning: !g.category_id,
          items: []
        });
      }

      const presList = g.products || [];
      presList.forEach(p => {
        const suppNames = (p.supplier_presentations || [])
          .map(sp => {
            const sName = sp.suppliers?.name;
            return sName && sName.trim().length > 0 ? sName.trim() : (sp.suppliers ? 'Proveedor sin nombre' : null);
          })
          .filter(Boolean);

        const supplierBadge = suppNames.length > 0
          ? `🏢 ${suppNames.join(', ')}`
          : '⚠️ Sin proveedor';

        categoryMap.get(catId).items.push({
          productGroupId: g.id,
          productName: g.name,
          presentationName: p.name,
          price: p.price,
          extraBadgeText: supplierBadge,
          isExtraWarning: suppNames.length === 0,
          rawGroup: g,
          rawPres: p
        });
      });
    });

    // Omitir categorías sin presentaciones (Requisito 9)
    return Array.from(categoryMap.values()).filter(group => group.items.length > 0);

  } else if (groupBy === 'supplier') {
    const supplierMap = new Map();
    const unassignedItems = [];

    productGroups.forEach(g => {
      const presList = g.products || [];
      presList.forEach(p => {
        const suppRels = p.supplier_presentations || [];
        const catBadgeText = g.categories?.name ? `📁 ${g.categories.name.trim()}` : '';

        if (suppRels.length === 0) {
          unassignedItems.push({
            productGroupId: g.id,
            productName: g.name,
            presentationName: p.name,
            price: p.price,
            extraBadgeText: catBadgeText,
            isExtraWarning: false,
            rawGroup: g,
            rawPres: p
          });
        } else {
          // Relación N:M: si una presentación tiene más de un proveedor,
          // aparece dentro de cada grupo de proveedor (Requisito 5)
          suppRels.forEach(sp => {
            const s = sp.suppliers;
            const suppId = s?.id || sp.supplier_id || 'unknown';
            // Proveedores sin nombre: etiqueta visual amigable (Requisito 8)
            const suppName = s?.name && s.name.trim().length > 0 ? s.name.trim() : 'Proveedor sin nombre';
            const suppContact = [s?.phone, s?.email].filter(Boolean).join(' · ');

            if (!supplierMap.has(suppId)) {
              supplierMap.set(suppId, {
                id: suppId,
                title: suppName,
                subtitle: suppContact,
                icon: '🏢',
                isWarning: false,
                items: []
              });
            }

            supplierMap.get(suppId).items.push({
              productGroupId: g.id,
              productName: g.name,
              presentationName: p.name,
              price: p.price,
              extraBadgeText: catBadgeText,
              isExtraWarning: false,
              rawGroup: g,
              rawPres: p
            });
          });
        }
      });
    });

    // Omitir proveedores sin presentaciones relacionadas (Requisito 9)
    const result = Array.from(supplierMap.values()).filter(group => group.items.length > 0);

    if (unassignedItems.length > 0) {
      result.push({
        id: 'unassigned-suppliers',
        title: 'Sin proveedor asignado',
        subtitle: 'Edita el producto para asignarle un proveedor',
        icon: '⚠️',
        isWarning: true,
        items: unassignedItems
      });
    }

    return result;
  }

  return [];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGroupedProductList(groupedData, groupBy) {
  let html = '<div class="compras-catalog-grouped">';

  groupedData.forEach(group => {
    const itemsCount = group.items.length;
    const countLabel = itemsCount === 1 ? '1 presentación' : `${itemsCount} presentaciones`;

    html += `
      <div class="compras-group-block">
        <div class="compras-group-heading">
          <span class="compras-heading-icon">${group.icon}</span>
          <h3 class="compras-heading-title">${escapeHtml(group.title)}</h3>
          ${group.subtitle ? `<span class="compras-supplier-contact">${escapeHtml(group.subtitle)}</span>` : ''}
          <span class="compras-heading-badge">${countLabel}</span>
        </div>
        <div class="compras-group-items-list">
          ${group.items.map(item => `
            <div class="compras-item-row">
              <div class="compras-unified-item-line">
                <span class="compras-item-prod-name">${escapeHtml(item.productName)}</span>
                <span class="compras-item-pres-name">${escapeHtml(item.presentationName)}</span>
                <span class="compras-item-price">$${parseFloat(item.price || 0).toFixed(2)}</span>
                ${item.extraBadgeText ? `<span class="compras-item-extra-info">${escapeHtml(item.extraBadgeText)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// -------------------------------------------------------------
// TEST SUITE
// -------------------------------------------------------------
console.log('=== TEST SUITE: GroupedProductList Visual & Structural Logic ===\n');

const mockSuppA = { id: 'supp-1', name: 'Distribuidora ABC', phone: '555-1111', email: 'abc@dist.com' };
const mockSuppB = { id: 'supp-2', name: 'Proveedor XYZ', phone: '555-2222', email: 'xyz@corp.com' };
const mockSuppUnnamed = { id: 'supp-3', name: '', phone: '555-3333' }; // Unnamed supplier

const sampleCatalog = [
  // Category 1: Café soluble
  {
    id: 'grp-1',
    name: 'Nescafé',
    category_id: 'cat-cafe',
    categories: { name: 'Café soluble' },
    products: [
      {
        id: 'pres-1',
        name: '1 kg',
        price: 250,
        supplier_presentations: [
          { supplier_id: mockSuppA.id, suppliers: mockSuppA },
          { supplier_id: mockSuppB.id, suppliers: mockSuppB } // Presentation 1 has 2 suppliers!
        ]
      },
      {
        id: 'pres-2',
        name: '500 g',
        price: 140,
        supplier_presentations: [
          { supplier_id: mockSuppB.id, suppliers: mockSuppB }
        ]
      }
    ]
  },
  {
    id: 'grp-2',
    name: 'Café Oro',
    category_id: 'cat-cafe',
    categories: { name: 'Café soluble' },
    products: [
      {
        id: 'pres-3',
        name: '1 kg',
        price: 230,
        supplier_presentations: [
          { supplier_id: mockSuppA.id, suppliers: mockSuppA }
        ]
      }
    ]
  },
  // Category 2: Refrescos
  {
    id: 'grp-3',
    name: 'Coca-Cola',
    category_id: 'cat-refrescos',
    categories: { name: 'Refrescos' },
    products: [
      {
        id: 'pres-4',
        name: '600 ml',
        price: 18,
        supplier_presentations: [
          { supplier_id: mockSuppA.id, suppliers: mockSuppA },
          { supplier_id: mockSuppB.id, suppliers: mockSuppB }
        ]
      },
      {
        id: 'pres-5',
        name: '1.5 L',
        price: 28,
        supplier_presentations: [
          { supplier_id: mockSuppB.id, suppliers: mockSuppB }
        ]
      }
    ]
  },
  {
    id: 'grp-4',
    name: 'Pepsi',
    category_id: 'cat-refrescos',
    categories: { name: 'Refrescos' },
    products: [
      {
        id: 'pres-6',
        name: '600 ml',
        price: 17,
        supplier_presentations: [
          { supplier_id: mockSuppUnnamed.id, suppliers: mockSuppUnnamed } // Has unnamed supplier
        ]
      }
    ]
  },
  // Category 3: Empty category (no presentations)
  {
    id: 'grp-empty',
    name: 'Producto Vacío',
    category_id: 'cat-vacia',
    categories: { name: 'Categoría Vacía' },
    products: []
  }
];

// Test 1: Category Grouping
console.log('1. Testing "Por categoría"...');
const byCategory = buildGroupedProductData(sampleCatalog, 'category');
console.log(`   Found ${byCategory.length} non-empty categories.`);

assert.strictEqual(byCategory.length, 2, 'Empty categories must be excluded');
assert.strictEqual(byCategory[0].title, 'Café soluble');
assert.strictEqual(byCategory[0].items.length, 3, 'Café soluble must have 3 presentations');
assert.strictEqual(byCategory[0].items[0].productName, 'Nescafé');
assert.strictEqual(byCategory[0].items[0].presentationName, '1 kg');
assert.strictEqual(byCategory[0].items[0].price, 250);
assert.strictEqual(byCategory[0].items[1].productName, 'Nescafé');
assert.strictEqual(byCategory[0].items[1].presentationName, '500 g');
assert.strictEqual(byCategory[0].items[1].price, 140);
assert.strictEqual(byCategory[0].items[2].productName, 'Café Oro');
assert.strictEqual(byCategory[0].items[2].presentationName, '1 kg');
assert.strictEqual(byCategory[0].items[2].price, 230);
console.log('   ✅ "Por categoría" structure matches specification exactly!');

// Test 2: Supplier Grouping
console.log('\n2. Testing "Por proveedor"...');
const bySupplier = buildGroupedProductData(sampleCatalog, 'supplier');
console.log(`   Found ${bySupplier.length} suppliers.`);

const suppA = bySupplier.find(s => s.title === 'Distribuidora ABC');
const suppB = bySupplier.find(s => s.title === 'Proveedor XYZ');
const suppUnnamed = bySupplier.find(s => s.title === 'Proveedor sin nombre');

assert.ok(suppA, 'Distribuidora ABC must exist');
assert.ok(suppB, 'Proveedor XYZ must exist');
assert.ok(suppUnnamed, 'Unnamed supplier must be labeled "Proveedor sin nombre"');

// Check multi-supplier presentation N:M behavior
const nesc1kgInA = suppA.items.find(i => i.productName === 'Nescafé' && i.presentationName === '1 kg');
const nesc1kgInB = suppB.items.find(i => i.productName === 'Nescafé' && i.presentationName === '1 kg');
assert.ok(nesc1kgInA, 'Nescafé 1 kg must appear under Distribuidora ABC');
assert.ok(nesc1kgInB, 'Nescafé 1 kg must ALSO appear under Proveedor XYZ');
console.log('   ✅ Multi-supplier presentation (N:M) verified under both suppliers!');
console.log('   ✅ Unnamed supplier verified as "Proveedor sin nombre"!');

// Test 3: Rendering parity
console.log('\n3. Testing Unified HTML Rendering...');
const htmlCat = renderGroupedProductList(byCategory, 'category');
const htmlSupp = renderGroupedProductList(bySupplier, 'supplier');

assert.ok(htmlCat.includes('compras-group-heading'), 'Category view has group headings');
assert.ok(htmlSupp.includes('compras-group-heading'), 'Supplier view has identical group headings');
assert.ok(htmlCat.includes('compras-item-prod-name'), 'Category view has item product names');
assert.ok(htmlSupp.includes('compras-item-prod-name'), 'Supplier view has item product names');
assert.ok(htmlCat.includes('compras-item-pres-name'), 'Category view has presentation names');
assert.ok(htmlSupp.includes('compras-item-pres-name'), 'Supplier view has presentation names');
console.log('   ✅ Unified component renders identical structure for both views!');

console.log('\n🎉 ALL LOGIC AND STRUCTURAL TESTS PASSED!\n');
