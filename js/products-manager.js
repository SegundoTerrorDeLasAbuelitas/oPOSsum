// =============================================================================
// oPOSsum - Products, Presentations & Categories Manager
// =============================================================================
import { getSupabase } from './supabase-client.js';
import { tenantManager } from './tenant-context.js';

export class ProductsManager {
  constructor() {
    this.supabase = getSupabase();
  }

  /**
   * Fetch all categories for the active tenant
   */
  async getCategories() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, description, created_at')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Create a new category for the active tenant
   */
  async createCategory(name, description = null) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) throw new Error('No hay tenant activo.');

    const cleanName = name.trim();
    if (!cleanName) throw new Error('El nombre de la categoría es obligatorio.');

    const { data, error } = await this.supabase
      .from('categories')
      .insert({
        tenant_id: tenantId,
        name: cleanName,
        description: description ? description.trim() : null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`La categoría "${cleanName}" ya existe.`);
      }
      console.error('Error creating category:', error);
      throw new Error(error.message || 'Error al crear la categoría.');
    }

    return data;
  }

  /**
   * Fetch all product groups with their nested presentations and category for the active tenant
   */
  async getProductGroupsWithPresentations() {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) return [];

    const { data, error } = await this.supabase
      .from('product_groups')
      .select(`
        id,
        name,
        description,
        image_url,
        created_at,
        category_id,
        categories (
          id,
          name
        ),
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
   * Create a Product Group with Category and its Presentations in a single atomic operation
   */
  async createProductWithPresentations(name, description, categoryId, presentations) {
    if (!tenantManager.currentTenant) {
      await tenantManager.init();
    }

    const tenantId = tenantManager.currentTenant?.id;
    if (!tenantId) {
      throw new Error('No hay un negocio/tenant activo seleccionado.');
    }

    const validPresentations = (presentations || [])
      .map(p => {
        const presName = typeof p === 'string' ? p.trim() : p.name?.trim();
        const price = typeof p === 'object' ? parseFloat(p.price) : 0;
        const cost = typeof p === 'object' ? parseFloat(p.cost || 0) : 0;
        return { name: presName, price: isNaN(price) ? 0 : price, cost: isNaN(cost) ? 0 : cost };
      })
      .filter(p => p.name && p.name.length > 0);

    if (validPresentations.length === 0) {
      throw new Error('Debes agregar al menos una presentación con su precio.');
    }

    for (const p of validPresentations) {
      if (p.price < 0) {
        throw new Error(`El precio de "${p.name}" no puede ser negativo.`);
      }
    }

    const { data, error } = await this.supabase.rpc('create_product_with_presentations', {
      p_tenant_id: tenantId,
      p_name: name.trim(),
      p_description: description ? description.trim() : null,
      p_category_id: categoryId || null,
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

    const parsedPrice = parseFloat(price) || 0;
    if (parsedPrice < 0) throw new Error('El precio no puede ser negativo.');

    const { data, error } = await this.supabase
      .from('products')
      .insert({
        tenant_id: tenantId,
        product_group_id: groupId,
        name: presentationName.trim(),
        price: parsedPrice,
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
   * Update Product Group details (Name, Description, Category)
   */
  async updateProductGroup(groupId, name, description, categoryId = null) {
    const { data, error } = await this.supabase
      .from('product_groups')
      .update({
        name: name.trim(),
        description: description ? description.trim() : null,
        category_id: categoryId || null,
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
