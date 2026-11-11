// Preview-only fallback for a Cloudflare Pages build without VITE_ variables.
// These are public browser credentials, not a service-role or secret key.
// Keep this preview configuration out of the production branch.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://mdjhdpyrnroywxoaaraa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_VgdzsMW1ZfMn1W2eqxV2rw_zW-6yTKw";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});
