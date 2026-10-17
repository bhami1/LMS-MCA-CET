import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const cleanUrl = rawUrl.trim().replace(/^['"]|['"]$/g, '');
const cleanKey = rawKey.trim().replace(/^['"]|['"]$/g, '');

const supabaseUrl = cleanUrl || 'https://placeholder.supabase.co';
const supabaseAnonKey = cleanKey || 'placeholder-anon-key';

export const isSupabaseConfigured = Boolean(
  cleanUrl &&
  cleanKey &&
  !cleanUrl.includes('placeholder')
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
