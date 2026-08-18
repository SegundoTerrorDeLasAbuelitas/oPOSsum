import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bhgvyeclmbmjkpgrheki.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ3Z5ZWNsbWJtamtwZ3JoZWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjQ4NTAsImV4cCI6MjEwMjY0MDg1MH0.3AIUCFPGt16ThLlbuCshcjJzeVIclg0tjlSdG8C81Hk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSignup() {
  console.log('Testing signup with bruno@opossum.test...');
  const { data, error } = await supabase.auth.signUp({
    email: 'bruno@opossum.test',
    password: 'password123',
    options: {
      data: { full_name: 'Bruno Chavarin' }
    }
  });

  if (error) {
    console.error('Signup error:', error);
  } else {
    console.log('Signup result:');
    console.log('User ID:', data.user?.id);
    console.log('Has Session:', !!data.session);
    console.log('Identities:', data.user?.identities);
  }
}

testSignup().catch(console.error);
