// =============================================================================
// oPOSsum - Suppliers Manager (Multi-Tenant)
// =============================================================================
import { getSupabase } from './supabase-client.js';
import { tenantManager } from './tenant-context.js';

export class SuppliersManager {
  constructor() {
    this.supabase = getSupabase();
  }

  /**
   * Fetch all suppliers for the active tenant
   */
  async getSuppliers() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('suppliers')
      .select('id, tenant_id, name, phone, email, notes, status, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching suppliers:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Create a new supplier.
   * IMPORTANT: NONE of the fields are mandatory.
   * Can be saved completely empty if the user desires.
   */
  async createSupplier({ name = '', phone = '', email = '', notes = '' }) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const cleanEmail = (email || '').trim();
    if (cleanEmail.length > 0) {
      // Basic email validation only if provided
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        throw new Error('El correo electrónico no tiene un formato válido.');
      }
    }

    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanNotes = (notes || '').trim();

    const { data, error } = await this.supabase
      .from('suppliers')
      .insert({
        tenant_id: tenantId,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        notes: cleanNotes,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating supplier:', error);
      throw new Error(error.message || 'Error al guardar el proveedor.');
    }

    return data;
  }

  /**
   * Update an existing supplier
   */
  async updateSupplier(id, { name = '', phone = '', email = '', notes = '' }) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const cleanEmail = (email || '').trim();
    if (cleanEmail.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        throw new Error('El correo electrónico no tiene un formato válido.');
      }
    }

    const { data, error } = await this.supabase
      .from('suppliers')
      .update({
        name: (name || '').trim(),
        phone: (phone || '').trim(),
        email: cleanEmail,
        notes: (notes || '').trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('Error updating supplier:', error);
      throw new Error(error.message || 'Error al actualizar el proveedor.');
    }

    return data;
  }

  /**
   * Fetch suppliers assigned to a specific presentation
   */
  async getSuppliersForPresentation(presentationId) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('supplier_presentations')
      .select(`
        id,
        supplier_id,
        product_id,
        last_purchase_cost,
        supplier_sku,
        is_primary,
        suppliers (
          id,
          name,
          phone,
          email,
          notes
        )
      `)
      .eq('product_id', presentationId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error fetching suppliers for presentation:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Assign a supplier to a presentation
   */
  async assignSupplierToPresentation(presentationId, supplierId, lastPurchaseCost = 0) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const cleanCost = Math.max(0, parseFloat(lastPurchaseCost) || 0.00);

    const { data, error } = await this.supabase
      .from('supplier_presentations')
      .upsert({
        tenant_id: tenantId,
        product_id: presentationId,
        supplier_id: supplierId,
        last_purchase_cost: cleanCost,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'supplier_id, product_id'
      })
      .select(`
        id,
        supplier_id,
        product_id,
        last_purchase_cost,
        suppliers (
          id,
          name,
          phone,
          email
        )
      `)
      .single();

    if (error) {
      console.error('Error assigning supplier to presentation:', error);
      throw new Error(error.message || 'Error al asignar proveedor.');
    }

    return data;
  }

  /**
   * Remove a supplier from a presentation
   */
  async removeSupplierFromPresentation(presentationId, supplierId) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const { error } = await this.supabase
      .from('supplier_presentations')
      .delete()
      .eq('product_id', presentationId)
      .eq('supplier_id', supplierId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error removing supplier from presentation:', error);
      throw new Error(error.message || 'Error al desvincular proveedor.');
    }

    return true;
  }
}

export const suppliersManager = new SuppliersManager();
