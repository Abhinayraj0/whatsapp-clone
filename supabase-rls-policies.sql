import { createClient } from '@supabase/supabase-js';

// Hardcoding your true public project endpoints directly avoids Expo web bundler sync issues
const supabaseUrl = 'https://rkqglhduwwzrvqtewgso.supabase.co';
const supabaseAnonKey = 'sb_publishable_dhs7LcNkdv03D2N_BWP5Iw_OPWe1'; // Replace with your FULL publishable key string from Supabase dashboard if truncated

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
