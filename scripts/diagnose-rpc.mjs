import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testUserAndTenant() {
  console.log('--- Testing exact signup and create_tenant RPC call ---');
  
  // 1. Sign in with a user
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  
  console.log('1. Signing up:', email);
  const { data: signData, error: signError } = await supabase.auth.signUp({
    email,
    password
  });
  if (signError) {
    console.error('SignUp failed:', signError);
    return;
  }
  console.log('User signed up. ID:', signData.user?.id);

  // 2. Sign in
  const { data: sessionData, error: sessError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (sessError) {
    console.error('SignIn failed:', sessError);
    return;
  }
  console.log('User signed in. Access token exists:', !!sessionData.session?.access_token);

  // 3. Call RPC create_tenant_with_owner
  console.log('3. Calling RPC create_tenant_with_owner...');
  const { data: rpcData, error: rpcError } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'China machinery',
    p_slug: 'china-machinery'
  });

  if (rpcError) {
    console.error('RPC Error details:', rpcError);
  } else {
    console.log('RPC Success:', rpcData);
  }

  // 4. Try calling again with same slug to see conflict behavior
  console.log('4. Calling again with same slug to check error message:');
  const { data: dupData, error: dupError } = await supabase.rpc('create_tenant_with_owner', {
    p_name: 'China machinery 2',
    p_slug: 'china-machinery'
  });
  console.log('Duplicate test result -> Error:', dupError?.message || dupError);
}

testUserAndTenant().catch(console.error);
