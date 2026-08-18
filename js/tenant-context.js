// =============================================================================
// oPOSsum - Multi-Tenant Context Manager
// =============================================================================
import { getSupabase } from './supabase-client.js';

export class TenantManager {
  constructor() {
    this.supabase = getSupabase();
    this.currentTenant = null;
    this.userTenants = [];
    this.currentRole = null;
  }

  /**
   * Initializes the tenant context for the currently logged in user.
   * Resolves the active tenant and loads their accessible businesses.
   */
  async init() {
    const { data: { user }, error: userError } = await this.supabase.auth.getUser();
    if (userError || !user) {
      this.clearContext();
      return { user: null, tenant: null };
    }

    // 1. Fetch user profile to see last active tenant
    const { data: profile } = await this.supabase
      .from('user_profiles')
      .select('last_active_tenant_id, full_name')
      .eq('id', user.id)
      .maybeSingle();

    // 2. Fetch all tenants this user belongs to (RLS ensures only their tenants are returned)
    const { data: tenantMemberships, error: memberError } = await this.supabase
      .from('tenant_users')
      .select(`
        role,
        is_active,
        tenants (
          id,
          name,
          slug,
          status
        )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (memberError) {
      console.error('Error fetching tenant memberships:', memberError);
      return { user, tenant: null, tenants: [] };
    }

    this.userTenants = (tenantMemberships || [])
      .filter(m => m.tenants && m.tenants.status === 'active')
      .map(m => ({
        ...m.tenants,
        role: m.role
      }));

    if (this.userTenants.length === 0) {
      // User has no business/tenant yet -> needs onboarding
      this.currentTenant = null;
      this.currentRole = null;
      return { user, tenant: null, tenants: [], needsOnboarding: true };
    }

    // 3. Resolve active tenant
    let active = null;
    if (profile?.last_active_tenant_id) {
      active = this.userTenants.find(t => t.id === profile.last_active_tenant_id);
    }
    if (!active) {
      active = this.userTenants[0];
    }

    this.currentTenant = active;
    this.currentRole = active.role;

    return {
      user,
      tenant: this.currentTenant,
      role: this.currentRole,
      tenants: this.userTenants,
      needsOnboarding: false
    };
  }

  /**
   * Switch the active tenant for the current user
   */
  async switchTenant(tenantId) {
    const target = this.userTenants.find(t => t.id === tenantId);
    if (!target) {
      throw new Error('No tienes acceso al negocio seleccionado.');
    }

    const { data: { user } } = await this.supabase.auth.getUser();
    if (user) {
      // Update profile last active tenant
      await this.supabase
        .from('user_profiles')
        .update({ last_active_tenant_id: tenantId })
        .eq('id', user.id);
    }

    this.currentTenant = target;
    this.currentRole = target.role;
    return this.currentTenant;
  }

  /**
   * Create a new tenant with the current user as Owner
   */
  async createTenant(businessName, businessSlug) {
    const { data, error } = await this.supabase.rpc('create_tenant_with_owner', {
      p_name: businessName,
      p_slug: businessSlug
    });

    if (error) {
      throw new Error(error.message || 'Error al crear el negocio.');
    }

    // Re-initialize tenant context
    await this.init();
    return data;
  }

  /**
   * Get an effective setting (Tenant override > Global system default)
   */
  async getSetting(key) {
    if (!this.currentTenant) {
      throw new Error('No hay un tenant activo.');
    }

    const { data, error } = await this.supabase.rpc('get_effective_setting', {
      p_tenant_id: this.currentTenant.id,
      p_key: key
    });

    if (error) {
      console.error(`Error resolving setting ${key}:`, error);
      return null;
    }

    return data;
  }

  /**
   * Set or override a setting for the active tenant (requires admin/owner role)
   */
  async setTenantOverride(key, value) {
    if (!this.currentTenant) {
      throw new Error('No hay un tenant activo.');
    }

    const { data, error } = await this.supabase
      .from('tenant_settings')
      .upsert({
        tenant_id: this.currentTenant.id,
        key: key,
        value: value,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id, key'
      })
      .select();

    if (error) {
      throw new Error(error.message || 'Error al guardar la configuración del negocio.');
    }

    return data;
  }

  /**
   * Reset a tenant setting override so it falls back to global default
   */
  async removeTenantOverride(key) {
    if (!this.currentTenant) {
      throw new Error('No hay un tenant activo.');
    }

    const { error } = await this.supabase
      .from('tenant_settings')
      .delete()
      .eq('tenant_id', this.currentTenant.id)
      .eq('key', key);

    if (error) {
      throw new Error(error.message || 'Error al restablecer la configuración.');
    }
  }

  clearContext() {
    this.currentTenant = null;
    this.userTenants = [];
    this.currentRole = null;
  }
}

export const tenantManager = new TenantManager();
