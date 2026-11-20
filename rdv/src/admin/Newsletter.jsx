import { useEffect, useMemo, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + ' %' : '–')
const SEG = { nonreserve: 'Pas encore réservé', methode: 'Méthode 97 € (budget bas)', absent: 'Appel manqué', rdv: 'Appel déjà prévu' }
const CLICK = { video: 'la vidéo', rdv: 'la réservation', methode: 'la Méthode' }
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')

/** Newsletter : résultats de chaque e-mail envoyé à toute la liste (envoyés, ouvertures, clics, rendez-vous pris ensuite). Ordinateur uniquement. */
export default function Newsletter({ toast }) {
  const [camps, setCamps] = useState(null); const [rows, setRows] = useState([]); const [cands, setCands] = useState([]); const [err, setErr] = useState('')
  const [sel, setSel] = usePS('nl_sel', ''); const [q, setQ] = useState('')
  const load = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('mail_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('mail_bc').select('id,campaign,lead_id,segment,status,sent_at,opened_at,open_n,clicked_at,click_n,click_to,cand_leads(first_name,email,unsub_at)').limit(5000),
      supabase.from('candidatures').select('email,created_at,status').limit(5000),
    ])
    if (a.error || b.error) { const m = friendlyError(a.error || b.error); setErr(m); return toast(m, true) }
    setErr(''); setCamps(a.data || []); setRows(b.data || []); setCands(c.data || [])
  }
  useEffect(() => { load() }, [])
  const cur = useMemo(() => camps?.find((c) => c.key === sel) || camps?.[0] || null, [camps, sel])
  const mine = useMemo(() => rows.filter((r) => r.campaign === cur?.key), [rows, cur])
  const rdvAfter = (r) => { const em = String(r.cand_leads?.email || '').toLowerCase(); return !!em && !!r.sent_at && cands.some((c) => String(c.email || '').toLowerCase() === em && c.status !== 'annule' && new Date(c.created_at) > new Date(r.sent_at)) }
  const tot = useMemo(() => {
    const sent = mine.filter((r) => r.status === 'envoye')
    return { all: mine.length, wait: mine.filter((r) => r.status === 'attente').length, sent: sent.length, open: sent.filter((r) => r.opened_at).length, click: sent.filter((r) => r.clicked_at).length,
      rdv: sent.filter(rdvAfter).length, unsub: sent.filter((r) => r.cand_leads?.unsub_at && new Date(r.cand_leads.unsub_at) > new Date(r.sent_at)).length }
  }, [mine, cands])
  const bySeg = useMemo(() => Object.keys(SEG).map((k) => { const s = mine.filter((r) => r.segment === k && r.status === 'envoye'); return { k, n: s.length, o: s.filter((r) => r.opened_at).length, c: s.filter((r) => r.clicked_at).length, r: s.filter(rdvAfter).length } }).filter((x) => x.n > 0), [mine, cands])
  const list = useMemo(() => mine.filter((r) => !q.trim() || `${r.cand_leads?.first_name || ''} ${r.cand_leads?.email || ''}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => (b.clicked_at ? 2 : b.opened_at ? 1 : 0) - (a.clicked_at ? 2 : a.opened_at ? 1 : 0) || a.id - b.id), [mine, q])

  if (!camps) return err ? <div><p className="muted">Impossible de charger la newsletter : {err}</p><button className="btn ghost sm" onClick={load}>Réessayer</button></div> : <p className="muted">Chargement…</p>
  if (!cur) return <div className="ev yt"><div className="ev-head"><div><h2 className="sh">Newsletter</h2><p className="muted">Aucun envoi pour l'instant.</p></div></div></div>
  return <div className="ev yt">
    <div className="ev-head"><div><h2 className="sh">Newsletter</h2><p className="muted">Ce que chaque e-mail envoyé à toute la liste a donné : ouvertures, clics et rendez-vous pris ensuite.</p></div></div>
    <div className="yt-tools">
      <select value={cur.key} onChange={(e) => setSel(e.target.value)} aria-label="Envoi">{camps.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
      <span className="muted s12">Objet : « {cur.subject} »{cur.report_at && !cur.report_sent ? ` · bilan automatique le ${when(cur.report_at)}` : cur.report_sent ? ' · bilan envoyé' : ''}</span>
      <span style={{ flex: 1 }} /><button type="button" className="btn ghost sm" onClick={load}>Actualiser</button>
    </div>
    <div className="ev-stats yt-kpi">{[['Envoyés', `${tot.sent}${tot.wait ? ' / ' + tot.all : ''}`], ['Ouvertures', `${tot.open} · ${pct(tot.open, tot.sent)}`], ['Clics', `${tot.click} · ${pct(tot.click, tot.sent)}`], ['Clics / ouvertures', pct(tot.click, tot.open)], ['RDV pris depuis l’envoi', tot.rdv], ['Désinscrits', tot.unsub]].map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
    {tot.wait > 0 && <p className="muted s12">{tot.wait} e-mail{tot.wait > 1 ? 's' : ''} encore en cours d'envoi (8 par minute, entre 9 h et 21 h).</p>}
    <section className="rt-card">
      <h3 className="rt-h" style={{ marginTop: 0 }}>Par groupe</h3>
      {!bySeg.length ? <p className="muted">Rien d'envoyé pour l'instant.</p> : <div className="yt-wrap"><table className="yt-tbl"><thead><tr><th>Groupe</th><th className="n">Envoyés</th><th className="n">Ouverts</th><th className="n">Clics</th><th className="n">RDV après</th></tr></thead>
        <tbody>{bySeg.map((s) => <tr key={s.k}><td>{SEG[s.k]}</td><td className="n">{s.n}</td><td className="n">{s.o} · {pct(s.o, s.n)}</td><td className="n">{s.c} · {pct(s.c, s.n)}</td><td className="n">{s.r}</td></tr>)}</tbody></table></div>}
      <p className="muted s12" style={{ marginTop: 10 }}>Les ouvertures sont approximatives : certaines messageries (Apple Mail surtout) comptent une ouverture sans que la personne ait lu, d'autres bloquent les images. Les clics sont fiables.</p>
    </section>
    <section className="rt-card yt-list">
      <div className="yt-tools"><h3 className="rt-h" style={{ margin: 0 }}>Destinataires</h3><input className="ti" type="search" placeholder="Rechercher un prénom ou une adresse…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="yt-wrap"><table className="yt-tbl"><thead><tr><th>Personne</th><th>Groupe</th><th>Envoyé</th><th>Ouvert</th><th>Clic</th></tr></thead>
        <tbody>{list.map((r) => <tr key={r.id}><td>{r.cand_leads?.first_name || '–'}<br /><small className="muted">{r.cand_leads?.email}</small></td><td>{SEG[r.segment]}</td>
          <td>{r.status === 'envoye' ? when(r.sent_at) : r.status === 'attente' ? <span className="muted">en attente</span> : <span className="muted">annulé</span>}</td>
          <td>{r.opened_at ? `${when(r.opened_at)}${r.open_n > 1 ? ` (×${r.open_n})` : ''}` : '–'}</td><td>{r.clicked_at ? `${when(r.clicked_at)} · ${CLICK[r.click_to] || ''}` : '–'}</td></tr>)}</tbody></table></div>
    </section>
  </div>
}
