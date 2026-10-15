import { supabase } from './supabase'
import { compressImage } from './ui'

export async function uploadPhoto(file, userId) {
  const blob = await compressImage(file)
  const path = `${userId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl
}

export async function loadProfiles() {
  const { data } = await supabase.from('profiles').select('*').order('role').order('name')
  const map = {}; (data || []).forEach(p => { map[p.id] = p }); return { list: data || [], map }
}

export async function loadSettings() {
  const { data } = await supabase.from('settings').select('*').eq('id', 1).single(); return data
}
export async function saveSettings(patch) {
  const { error } = await supabase.from('settings').update(patch).eq('id', 1); if (error) throw error
}

export function friendlyError(e) {
  const m = (e && (e.message || e.error_description || String(e))) || 'Erreur'
  return m.replace(/^.*?: /, '').replace(/^new row violates.*$/, "Tu n'as pas le droit de faire ça")
}
