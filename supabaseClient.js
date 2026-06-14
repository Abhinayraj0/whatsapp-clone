import { createClient } from '@supabase/supabase-js';

// Clean, direct configuration strings bypass the Expo environment wrapper entirely
const supabaseUrl = 'https://rkqglhduwwzrvqtewgso.supabase.co';
const supabaseAnonKey = 'sb_publishable_dhs7LcNkdv03D2N_BWP5Iw_OPWe1JdV';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true
  }
});
