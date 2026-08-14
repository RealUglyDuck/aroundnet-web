import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Public config — safe to ship in the browser. RLS protects the data.
// Points at the same Supabase project the iOS app uses.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://iqtgfnevkpktuubkejbq.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_kGtKAq7wD9e7FgBkyImeEg_GEvwW4pi";

/**
 * Singleton browser client (persists the session in localStorage).
 *
 * Sign-in is email + password. Implicit flow (not PKCE) suits a static SPA and is
 * still needed for the two emailed links — confirm-your-address and
 * password-recovery — which come back with the session tokens in the URL hash for
 * detectSessionInUrl to parse.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});
