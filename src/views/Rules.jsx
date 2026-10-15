import { useState } from 'react'
import { saveSettings, friendlyError } from '../lib/data'
import { Switch } from '../lib/ui'

/** Règles du chat : partagées entre Modération et Administration. */
export default function Rules({ settings, toast }) {
  const [word, setWord] = useState('')
  const set = async (patch, msg) => { try { await saveSettings(patch); if (msg) toast(msg) } catch (e) { toast(friendlyError(e), true) } }
  const banned = settings.banned_words || []
  const add = () => { const v = word.trim().toLowerCase(); if (!v || banned.includes(v)) return; set({ banned_words: [...banned, v] }, `« ${v} » ajouté aux mots bannis`); setWord('') }
  return <div className="post"><b>Règles du chat</b>
    <div className="row"><label>Mode lent<small>Messages par membre et par minute (les coachs ne sont pas limités)</small></label>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="range" min={0} max={10} step={1} value={settings.slow_mode} onChange={e => set({ slow_mode: +e.target.value })} /><output>{settings.slow_mode ? settings.slow_mode + '/min' : 'off'}</output></span></div>
    <div className="row"><label>Chat ouvert aux membres<small>Fermé = seuls les coachs écrivent</small></label><Switch on={settings.chat_open} label="Chat ouvert" onChange={v => set({ chat_open: v }, v ? 'Chat ouvert' : 'Chat fermé aux membres')} /></div>
    <div className="row"><label>Coachs seulement pendant les lives<small>Pense à le désactiver à la fin du live</small></label><Switch on={settings.live_only} label="Mode live" onChange={v => set({ live_only: v }, v ? 'Mode live activé' : 'Mode live désactivé')} /></div>
    <div className="row"><label>Valider les posts du fil avant publication<small>Les posts des membres passent par un modérateur</small></label><Switch on={settings.approve_posts} label="Validation" onChange={v => set({ approve_posts: v }, v ? 'Validation des posts activée' : 'Validation désactivée')} /></div>
    <div className="row col"><label>Mots à bannir<small>Un message qui contient un de ces mots est {settings.ban_mode === 'block' ? 'bloqué avant envoi' : 'envoyé mais signalé aux modérateurs'}. Les coachs ne sont pas filtrés.</small></label>
      <div className="tags">{banned.map((w, i) => <span key={w} className="tag">{w}<button aria-label="Retirer" onClick={() => set({ banned_words: banned.filter((_, j) => j !== i) })}>✕</button></span>)}{banned.length === 0 && <small className="muted">Aucun</small>}</div>
      <div className="replybox" style={{ margin: 0 }}><input placeholder="Ajouter un mot ou une expression…" value={word} onChange={e => setWord(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <select value={settings.ban_mode} onChange={e => set({ ban_mode: e.target.value })}><option value="block">Bloquer</option><option value="flag">Laisser passer + signaler</option></select>
        <button className="btn" onClick={add}>Ajouter</button></div></div>
  </div>
}
