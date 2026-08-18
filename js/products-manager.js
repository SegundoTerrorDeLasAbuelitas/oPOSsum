// =============================================================================
// oPOSsum - Products & Presentations Manager
// =============================================================================
import { getSupabase } from './supabase-client.js';
import { tenantManager } from './tenant-context.js';

export class ProductsManager {
  constructor() {
    this.supabase = getSupabase();
  }

  /**
   * Fetch all product groups with their nested presentations for the active tenant
   */
  async getProductGroupsWithPresentations() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    // Query product_groups and joined products
    const { data, error } = await this.supabase
      .from('product_groups')
      .select(`
        id,
        name,
        description,
        image_url,
        created_at,
        products (
          id,
          name,
          price,
          cost,
          status,
          sku,
          barcode,
          created_at
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching product groups:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Create a Product Group with its Presentations in a single atomic operation
   * @param {string} name - Product group name, e.g. "Nescafé"
   * @param {string} description - Optional description, e.g. "Café soluble"
   * @param {Array<{name: string, price?: number, cost?: number}>} presentations - List of presentations
   */
  async createProductWithPresentations(name, description, presentations) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) {
      throw new Error('No hay un negocio/tenant activo seleccionado.');
    }

    // Filter valid presentation items
    const validPresentations = (presentations || [])
      .map(p => typeof p === 'string' ? { name: p.trim() } : { ...p, name: p.name?.trim() })
      .filter(p => p.name && p.name.length > 0);

    if (validPresentations.length === 0) {
      throw new Error('Debes agregar al menos una presentación para el producto.');
    }

    const { data, error } = await this.supabase.rpc('create_product_with_presentations', {
      p_tenant_id: tenantId,
      p_name: name.trim(),
      p_description: description ? description.trim() : null,
      p_presentations: validPresentations
    });

    if (error) {
      console.error('Error creating product with presentations:', error);
      throw new Error(error.message || 'Error al guardar el producto.');
    }

    return data;
  }

  /**
   * Add a new presentation to an existing product group
   */
  async addPresentationToGroup(groupId, presentationName, price = 0, cost = 0) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const { data, error } = await this.supabase
      .from('products')
      .insert({
        tenant_id: tenantId,
        product_group_id: groupId,
        name: presentationName.trim(),
        price: parseFloat(price) || 0,
        cost: parseFloat(cost) || 0,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding presentation:', error);
      throw new Error(error.message || 'Error al agregar la presentación.');
    }

    return data;
  }

  /**
   * Update Product Group details (Name, Description)
   */
  async updateProductGroup(groupId, name, description) {
    const { data, error } = await this.supabase
      .from('product_groups')
      .update({
        name: name.trim(),
        description: description ? description.trim() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', groupId)
      .select()
      .single();

    if (error) {
      console.error('Error updating product group:', error);
      throw new Error(error.message || 'Error al actualizar el producto.');
    }

    return data;
  }
}

export const productsManager = new ProductsManager();
