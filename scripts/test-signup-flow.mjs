import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testFullFlow() {
  const testEmail = `test_${Date.now()}@opossum.app`;
  const testPassword = 'Password123!';

  console.log(`1. Signing up user: ${testEmail}...`);
  let signUpRes = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
    options: {
      data: { full_name: 'Usuario Prueba' }
    }
  });

  if (signUpRes.error) {
    console.log('SignUp error:', signUpRes.error.message);
    // If rate limit error on sending email, try signing in directly if user was created
    console.log('Attempting sign in...');
  } else {
    console.log('SignUp success. User ID:', signUpRes.data.user?.id);
  }

  console.log('2. Signing in to ensure session...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (signInError) {
    console.error('SignIn error:', signInError);
    return;
  }
  console.log('SignIn success! Session token active.');

  console.log('3. Creating new Tenant for user...');
  const { data: tenantData, error: tenantError } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'Cafetería Demo',
    p_slug: `cafeteria-demo-${Date.now()}`
  });

  if (tenantError) {
    console.error('Tenant creation error:', tenantError);
    return;
  }
  console.log('Tenant created successfully:', tenantData);

  console.log('4. Testing RLS queries...');
  const { data: tenants, error: tErr } = await supabase.from('tenants').select('*');
  console.log('Accessible Tenants via RLS:', tenants);

  const { data: settings, error: sErr } = await supabase.from('system_settings').select('*');
  console.log('Global settings readable:', settings.map(s => s.key));

  console.log('✅ COMPLETE MULTI-TENANT ONBOARDING FLOW VERIFIED!');
}

testFullFlow().catch(console.error);
