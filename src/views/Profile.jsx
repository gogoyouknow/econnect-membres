import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { Avatar, compressImage, ROLE_LABEL, TIER_LABEL, Switch } from '../lib/ui'
import { UpsellCard } from './Upsell'

export default function Profile({ me, toast, refresh, settings }) {
  const [showCancel, setShowCancel] = useState(false)
  const [first, setFirst] = useState(me.first_name || me.name.split(' ')[0] || '')
  const [last, setLast] = useState(me.last_name || '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  async function save(e) {
    e.preventDefault(); if (!first.trim()) return toast('Ton prénom est obligatoire', true)
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', me.id)
    setBusy(false); if (error) return toast(friendlyError(error), true); toast('Profil enregistré'); refresh()
  }
  async function photo(e) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    try { const blob = await compressImage(f, 512, 0.85); const path = `${me.id}/avatar-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' }); if (error) throw error
      const url = supabase.storage.from('photos').getPublicUrl(path).data.publicUrl
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', me.id); toast('Photo mise à jour'); refresh()
    } catch (x) { toast(friendlyError(x), true) }
  }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Mon profil</h2><small>{ROLE_LABEL[me.role]}{me.role === 'member' ? ` · Groupe ${TIER_LABEL[me.tier]}` : ''} · {me.email}</small></div></div>
    <div className="body">
      <form className="post form" onSubmit={save} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar p={me} className="" /><div style={{ flex: 1 }}>
            <button type="button" className="btn ghost sm" onClick={() => fileRef.current.click()}>Changer la photo</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={photo} />
          </div>
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="pf">Prénom</label><input id="pf" value={first} onChange={e => setFirst(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pl">Nom</label><input id="pl" value={last} onChange={e => setLast(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
          <button className="btn" disabled={busy}>Enregistrer</button>
        </div>
      </form>
      {me.role === 'member' && <div className="post" style={{ maxWidth: 520 }}><b>Mon abonnement</b>
        <div className="row"><label>{me.tier === 2 ? 'Accompagnement personnalisé' : 'Abonnement Démarrage'}<small>{me.tier === 2 ? '450 €/mois · groupe Accélération ouvert' : '250 €/mois'}</small></label><span className={`pill ${me.tier === 2 ? 'gold' : ''}`}>{TIER_LABEL[me.tier]}</span></div>
        {me.tier < 2 && <UpsellCard settings={settings} me={me} compact />}
        <div className="cancel">
          <button type="button" className="linkbtn" onClick={() => setShowCancel(v => !v)}>{showCancel ? 'Masquer' : 'Besoin de résilier ?'}</button>
          {showCancel && <div className="cancelbox">
            <p>Si tu souhaites annuler ton abonnement, envoie ta demande de résiliation par email à <b>{settings?.cancel_email || 'resiliation@theambitiousman.fr'}</b> depuis l'adresse de ton compte ({me.email}).</p>
            <p><b>Important :</b> {settings?.cancel_text || 'ta demande doit nous parvenir avant la fin du mois en cours pour ne pas être prélevé le mois suivant.'}</p>
          </div>}
        </div>
      </div>}
      <div className="post" style={{ maxWidth: 520 }}><b>Notifications</b>
        <div className="row"><label>Quand on me mentionne (@{(me.first_name || me.name.split(' ')[0])})<small>Dans le chat ou le fil</small></label><Switch on={me.notif_mentions !== false} label="Mentions" onChange={v => supabase.from('profiles').update({ notif_mentions: v }).eq('id', me.id).then(() => { toast(v ? 'Mentions activées' : 'Mentions désactivées'); refresh() })} /></div>
        <div className="row"><label>Quand on répond à mes messages</label><Switch on={me.notif_replies !== false} label="Réponses" onChange={v => supabase.from('profiles').update({ notif_replies: v }).eq('id', me.id).then(() => { toast(v ? 'Réponses activées' : 'Réponses désactivées'); refresh() })} /></div>
        <div className="row"><label>Lives<small>Rappel quand un live est programmé</small></label><Switch on={me.notif_lives !== false} label="Lives" onChange={v => supabase.from('profiles').update({ notif_lives: v }).eq('id', me.id).then(() => { toast(v ? 'Rappels de live activés' : 'Rappels de live désactivés'); refresh() })} /></div>
      </div>
    </div>
  </>
}
