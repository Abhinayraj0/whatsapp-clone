import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const FALLBACK_SUPABASE_URL = 'https://rkqglhduwwzrvqtewgso.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'PASTE_YOUR_COPIED_SB_PUBLISHABLE_KEY_HERE';

const env = typeof process !== 'undefined' && process.env ? process.env : {};
const EXPO_PUBLIC_SUPABASE_URL =
  typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_SUPABASE_URL : '';
const EXPO_PUBLIC_SUPABASE_ANON_KEY =
  typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY : '';

const SUPABASE_URL = String(
  EXPO_PUBLIC_SUPABASE_URL ||
  env.REACT_APP_SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL
).trim();

const SUPABASE_ANON_KEY = String(
  EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  env.REACT_APP_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  FALLBACK_SUPABASE_ANON_KEY
).trim();

if (!SUPABASE_URL || SUPABASE_ANON_KEY === 'PASTE_YOUR_COPIED_SB_PUBLISHABLE_KEY_HERE') {
  throw new Error('Supabase URL and anon key must be configured as public web strings before creating the client.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true
  }
});
