// =============================================================================
// oPOSsum - Purchases & Procurement Manager
// =============================================================================
import { getSupabase } from './supabase-client.js';
import { tenantManager } from './tenant-context.js';

export class PurchasesManager {
  constructor() {
    this.supabase = getSupabase();
  }

  /**
   * Fetch purchase history for active tenant, ordered most recent first
   */
  async getPurchasesHistory() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('purchases')
      .select(`
        id,
        folio,
        folio_number,
        supplier_id,
        supplier_name,
        purchase_date,
        reference,
        subtotal,
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
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase history:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Fetch single purchase with all its historical line items & supplier details
   */
  async getPurchaseDetail(purchaseId) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const { data, error } = await this.supabase
      .from('purchases')
      .select(`
        id,
        folio,
        folio_number,
        supplier_id,
        supplier_name,
        purchase_date,
        reference,
        subtotal,
        total,
        status,
        notes,
        created_at,
        suppliers (
          id,
          name,
          phone,
          email
        ),
        purchase_items (
          id,
          presentation_id,
          product_name,
          presentation_name,
          quantity,
          unit_cost,
          subtotal
        )
      `)
      .eq('id', purchaseId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      console.error('Error fetching purchase detail:', error);
      throw error;
    }

    return data;
  }

  /**
   * Finalize and register a purchase order in Supabase atomically
   * @param {Object} params
   * @param {string|null} params.supplierId
   * @param {string} [params.purchaseDate]
   * @param {string} [params.reference]
   * @param {string} [params.notes]
   * @param {Array<{presentation_id: string, product_name: string, presentation_name: string, quantity: number, unit_cost: number}>} params.items
   */
  async createPurchaseOrder({ supplierId = null, purchaseDate = null, reference = '', notes = '', items = [] }) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) {
      throw new Error('No hay un negocio/tenant activo seleccionado.');
    }

    if (!items || items.length === 0) {
      throw new Error('La orden de compra no contiene productos.');
    }

    // Format items payload
    const formattedItems = items.map(item => ({
      presentation_id: item.presentation_id || item.id,
      product_name: item.product_name || item.productName || 'Producto',
      presentation_name: item.presentation_name || item.presentationName || 'Estándar',
      quantity: parseFloat(item.quantity || item.qty) || 1.00,
      unit_cost: parseFloat(item.unit_cost || item.cost || item.unitCost) || 0.00
    }));

    const { data, error } = await this.supabase.rpc('create_purchase_order', {
      p_tenant_id: tenantId,
      p_supplier_id: supplierId || null,
      p_purchase_date: purchaseDate || new Date().toISOString().split('T')[0],
      p_reference: reference ? reference.trim() : null,
      p_notes: notes ? notes.trim() : null,
      p_items: formattedItems
    });

    if (error) {
      console.error('Error creating purchase order:', error);
      throw new Error(error.message || 'Error al procesar la compra.');
    }

    return data;
  }
}

export const purchasesManager = new PurchasesManager();
