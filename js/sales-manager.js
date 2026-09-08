// =============================================================================
// oPOSsum - Sales & Checkout Manager
// =============================================================================
import { getSupabase } from './supabase-client.js';
import { tenantManager } from './tenant-context.js';

export class SalesManager {
  constructor() {
    this.supabase = getSupabase();
  }

  /**
   * Fetch sales history for active tenant, ordered most recent first
   */
  async getSalesHistory() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('sales')
      .select(`
        id,
        folio,
        folio_number,
        customer_name,
        sale_date,
        subtotal,
        discount_amount,
        total,
        payment_method,
        status,
        created_at,
        sale_items (
          id,
          quantity,
          unit_price,
          subtotal,
          product_name
        )
      `)
      .eq('tenant_id', tenantId)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching sales history:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Fetch single sale with all its historical line items
   */
  async getSaleDetail(saleId) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const { data, error } = await this.supabase
      .from('sales')
      .select(`
        id,
        folio,
        folio_number,
        customer_name,
        subtotal,
        discount_amount,
        total,
        payment_method,
        status,
        created_at,
        sale_items (
          id,
          product_id,
          product_name,
          quantity,
          unit_price,
          subtotal
        )
      `)
      .eq('id', saleId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      console.error('Error fetching sale detail:', error);
      throw error;
    }

    return data;
  }

  /**
   * Complete checkout and generate atomic sale order with folio
   * @param {Array<{product_id: string, product_name: string, quantity: number, unit_price: number}>} items 
   * @param {string} customerName 
   * @param {number} discountAmount 
   * @param {string} paymentMethod 
   * @param {string|null} saleDate YYYY-MM-DD format
   */
  async checkoutSale(items, customerName = 'Cliente Mostrador', discountAmount = 0, paymentMethod = 'cash', saleDate = null) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) {
      throw new Error('No hay un negocio/tenant activo seleccionado.');
    }

    if (!items || items.length === 0) {
      throw new Error('El carrito de venta está vacío.');
    }

    // Format items payload
    const formattedItems = items.map(item => ({
      product_id: item.product_id || item.id,
      product_name: item.product_name || item.name,
      quantity: parseFloat(item.quantity || item.qty) || 1,
      unit_price: parseFloat(item.unit_price || item.price) || 0
    }));

    const finalSaleDate = saleDate && /^\d{4}-\d{2}-\d{2}$/.test(saleDate)
      ? saleDate
      : new Date().toISOString().split('T')[0];

    const { data, error } = await this.supabase.rpc('create_sale_checkout', {
      p_tenant_id: tenantId,
      p_customer_name: customerName || 'Cliente Mostrador',
      p_items: formattedItems,
      p_discount_amount: parseFloat(discountAmount) || 0,
      p_payment_method: paymentMethod || 'cash',
      p_sale_date: finalSaleDate
    });

    if (error) {
      console.error('Error creating sale:', error);
      throw new Error(error.message || 'Error al procesar la venta.');
    }

    return data;
  }
}

export const salesManager = new SalesManager();
