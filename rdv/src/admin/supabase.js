import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, (String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] || ''), { auth: { persistSession: true, autoRefreshToken: true } })
export const friendlyError = (e) => ((e && (e.message || String(e))) || 'Erreur').replace(/^new row violates.*$/, "Tu n'as pas le droit de faire ça")
