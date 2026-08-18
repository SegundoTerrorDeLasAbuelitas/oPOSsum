// =============================================================================
// oPOSsum - Supabase Client Setup
// =============================================================================
// Official Supabase JS SDK initializer using public credentials

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

// Initialize Supabase Client from window.supabase (via CDN script) or ES Modules
export function getSupabase() {
  if (typeof window !== 'undefined' && window._opossumSupabase) {
    return window._opossumSupabase;
  }
  
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    window._opossumSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
    return window._opossumSupabase;
  }

  throw new Error('Supabase SDK not loaded on window.');
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
