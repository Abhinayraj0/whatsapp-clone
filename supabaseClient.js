import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

// Your project credentials plugged in live:
const SUPABASE_URL = 'https://rkqglhduwwzrvqtewgso.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_COPIED_SB_PUBLISHABLE_KEY_HERE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
