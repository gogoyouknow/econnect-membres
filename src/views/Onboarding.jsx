import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { compressImage, initials } from '../lib/ui'
import Logo from '../lib/Logo'

/** Première connexion : prénom, nom, photo. Rien de plus. */
export default function Onboarding({ me, onDone, toast }) {
  const [first, setFirst] = useState(me.first_name || '')
  const [last, setLast] = useState(me.last_name || '')
  const [photo, setPhoto] = useState(null) // {file,url}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  async function save(e) {
    e.preventDefault()
    const f = first.trim(), l = last.trim()
    if (!f) return setErr('Ton prénom, au minimum.')
    setBusy(true); setErr('')
    try {
      let avatar_url = me.avatar_url || null
      if (photo) {
        const blob = await compressImage(photo.file, 512, 0.85)
        const path = `${me.id}/avatar-${Date.now()}.jpg`
        const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (error) throw error
        avatar_url = supabase.storage.from('photos').getPublicUrl(path).data.publicUrl
      }
      const { error } = await supabase.from('profiles').update({ first_name: f, last_name: l, avatar_url, onboarded: true }).eq('id', me.id)
      if (error) throw error
      toast(`Bienvenue, ${f} 👋`)
      onDone()
    } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  const preview = photo?.url || me.avatar_url
  return (
    <section className="login">
      <form className="card" onSubmit={save}>
        <Logo size={34} />
        <h1>Fais-toi connaître du groupe</h1>
        <p>Ton prénom et ta photo s'affichent à côté de tes messages. Ça prend 20 secondes.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '4px 0' }}>
          <button type="button" className="av" onClick={() => fileRef.current.click()} aria-label="Choisir une photo"
            style={{ width: 76, height: 76, fontSize: 24, border: '2px dashed var(--gold)', cursor: 'pointer', background: preview ? 'transparent' : undefined }}>
            {preview ? <img src={preview} alt="" /> : (first ? initials(first + ' ' + last) : '📷')}
          </button>
          <div style={{ flex: 1 }}>
            <button type="button" className="btn ghost sm" onClick={() => fileRef.current.click()}>{preview ? 'Changer la photo' : 'Ajouter une photo'}</button>
            <div className="small muted" style={{ marginTop: 6 }}>Facultatif. Une photo de toi, pas un logo.</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPhoto({ file: f, url: URL.createObjectURL(f) }) }} />
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="first">Prénom</label><input id="first" autoComplete="given-name" placeholder="Awa" value={first} onChange={e => setFirst(e.target.value)} required /></div>
          <div className="field"><label htmlFor="last">Nom</label><input id="last" autoComplete="family-name" placeholder="Diallo" value={last} onChange={e => setLast(e.target.value)} /></div>
        </div>
        <div className="err">{err}</div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Entrer dans le groupe'}</button>
        <div className="legal">Tu pourras modifier ça plus tard depuis ton profil.</div>
      </form>
    </section>
  )
}
