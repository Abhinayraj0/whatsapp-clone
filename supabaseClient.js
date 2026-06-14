import { createClient } from '@supabase/supabase-js';

const KNOWN_DEAD_SUPABASE_URL = 'https://rkqglhduwwzrvqtewgso.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_dhs7LcNkdv03D2N_BWP5Iw_OPWe1JdV';

const env = typeof process !== 'undefined' && process.env ? process.env : {};
const expoSupabaseUrl =
  typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_SUPABASE_URL : '';
const expoSupabaseAnonKey =
  typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY : '';

const readString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const normalizeSupabaseUrl = (value) => {
  const trimmedValue = readString(value).replace(/\/+$/, '');

  if (!trimmedValue) {
    return '';
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(trimmedValue)) {
    throw new Error('SUPABASE_URL must look like https://your-project-ref.supabase.co');
  }

  if (trimmedValue === KNOWN_DEAD_SUPABASE_URL) {
    throw new Error(
      `${KNOWN_DEAD_SUPABASE_URL} does not resolve in DNS. Replace EXPO_PUBLIC_SUPABASE_URL with the real Project URL from Supabase Settings > API.`
    );
  }

  return trimmedValue;
};

const createUnavailableClient = (message) => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: new Error(message) }),
    onAuthStateChange: () => ({
      data: {
        subscription: {
          unsubscribe: () => {}
        }
      }
    }),
    signInWithPassword: async () => {
      throw new Error(message);
    },
    signOut: async () => {},
    signUp: async () => {
      throw new Error(message);
    }
  },
  channel: () => ({
    on: () => ({ subscribe: () => {} }),
    subscribe: () => {}
  }),
  from: () => {
    throw new Error(message);
  },
  removeChannel: () => {}
});

const buildSupabaseClient = () => {
  const supabaseUrl = normalizeSupabaseUrl(
    expoSupabaseUrl,
    env.REACT_APP_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_URL
  );

  const supabaseAnonKey = readString(
    expoSupabaseAnonKey,
    env.REACT_APP_SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.SUPABASE_ANON_KEY,
    FALLBACK_SUPABASE_ANON_KEY
  );

  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL. Set it to the Project URL from Supabase Settings > API.');
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. Set it to the publishable anon key from Supabase Settings > API.');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true
    }
  });
};

let supabaseConfigError = '';
let supabase = null;

try {
  supabase = buildSupabaseClient();
} catch (error) {
  supabaseConfigError = error.message ?? 'Supabase is not configured correctly.';
  supabase = createUnavailableClient(supabaseConfigError);
}

export { supabase, supabaseConfigError };
