import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't throw at module load: `next build` evaluates every route module, so a
  // throw here crashes the whole build when the env vars aren't present in the
  // build environment (e.g. Vercel Preview deployments). Warn instead and fall
  // back to a placeholder client — real requests will simply fail at runtime if
  // the deployment is genuinely unconfigured.
  console.warn('Supabase env vars missing — DB calls will fail until NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are set.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
);