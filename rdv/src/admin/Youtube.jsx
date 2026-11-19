import { useEffect, useMemo, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'
import { copyText } from './copy'

const BASE = 'https://rdv.theambitiousman.fr'
const EVENT_LINK = `${BASE}/e/youtube`
// Un lien par vidéo : la vidéo est reconnue grâce à son identifiant, mis dans utm_campaign (le suivi de provenance de Calio le garde sur la fiche du prospect).
const linkOf = (id) => `${EVENT_LINK}?utm_source=youtube&utm_medium=video&utm_campaign=${encodeURIComponent(id)}`
// Identifiant (11 caractères) d'un lien YouTube normal, court, Shorts, live ou intégré — ou d'un identifiant collé tel quel.
const idOf = (s) => { const t = String(s || '').trim(); const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) || t.match(/^([A-Za-z0-9_-]{11})$/); return m ? m[1] : null }
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + ' %' : '–')
const eur = (n) => (n ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n) : '–')
const dshort = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const PAGE = 30
const EMPTY = { leads: 0, rdv: 0, faits: 0, signes: 0, montant: 0 }
const SORTS = { recent: 'Plus récentes', rdv: 'Plus de rendez-vous', signes: 'Plus de signés', leads: 'Plus de prospects', titre: 'Titre (A → Z)' }

// Titre d'une vidéo (page publique de YouTube) ; si ça ne répond pas, on garde un titre à compléter.
async function titleOf(id) {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000)
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { signal: c.signal }); clearTimeout(t)
    if (!r.ok) return ''
    return String((await r.json()).title || '').slice(0, 200)
  } catch { return '' }
}

/** YouTube : un lien de réservation par vidéo, avec les prospects, rendez-vous et signatures qu'elle a apportés. Ordinateur uniquement. */
export default function Youtube({ toast }) {
  const [vids, setVids] = useState(null); const [stats, setStats] = useState([]); const [evOk, setEvOk] = useState(true)
  const [q, setQ] = usePS('yt_q', ''); const [sort, setSort] = usePS('yt_sort', 'recent'); const [shown, setShown] = useState(PAGE)
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false)
  const load = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('yt_videos').select('*').order('created_at', { ascending: false }).limit(3000),
      supabase.rpc('yt_stats'),
      supabase.from('cand_events').select('id').eq('slug', 'youtube').maybeSingle(),
    ])
    if (a.error) return toast(friendlyError(a.error), true)
    setVids(a.data || []); setStats(b.data || []); setEvOk(!!c.data)
    if (b.error) toast(friendlyError(b.error), true)
  }
  useEffect(() => { load() }, [])
  const sm = useMemo(() => { const m = {}; (stats || []).forEach((r) => { m[r.campaign] = r }); return m }, [stats])
  const st = (id) => ({ ...EMPTY, ...(sm[id] || {}) })
  const known = useMemo(() => new Set((vids || []).map((v) => v.video_id)), [vids])
  const total = useMemo(() => (stats || []).reduce((t, r) => ({ leads: t.leads + r.leads, rdv: t.rdv + r.rdv, faits: t.faits + r.faits, signes: t.signes + r.signes, montant: t.montant + Number(r.montant || 0) }), { ...EMPTY }), [stats])
  // Prospects arrivés par YouTube mais sans vidéo reconnue (lien sans identifiant, vidéo supprimée de la liste…)
  const autres = useMemo(() => (stats || []).filter((r) => !known.has(r.campaign)).reduce((t, r) => ({ leads: t.leads + r.leads, rdv: t.rdv + r.rdv, faits: t.faits + r.faits, signes: t.signes + r.signes, montant: t.montant + Number(r.montant || 0) }), { ...EMPTY }), [stats, known])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = (vids || []).filter((v) => !s || (v.title + ' ' + v.video_id + ' ' + (v.note || '')).toLowerCase().includes(s))
    const by = { recent: (a, b) => b.created_at.localeCompare(a.created_at), rdv: (a, b) => st(b.video_id).rdv - st(a.video_id).rdv || b.created_at.localeCompare(a.created_at), signes: (a, b) => st(b.video_id).signes - st(a.video_id).signes || st(b.video_id).rdv - st(a.video_id).rdv, leads: (a, b) => st(b.video_id).leads - st(a.video_id).leads, titre: (a, b) => (a.title || '').localeCompare(b.title || '', 'fr') }
    return l.sort(by[sort] || by.recent)
  }, [vids, q, sort, sm])

  const add = async (e) => {
    e.preventDefault()
    const ids = [...new Set(text.split(/[\s,;]+/).map(idOf).filter(Boolean))]
    if (!ids.length) return toast('Colle au moins un lien de vidéo YouTube.', true)
    const nouv = ids.filter((i) => !known.has(i)); const deja = ids.length - nouv.length
    if (!nouv.length) return toast(deja > 1 ? 'Ces vidéos sont déjà dans la liste.' : 'Cette vidéo est déjà dans la liste.', true)
    setBusy(true)
    const titles = await Promise.all(nouv.map(titleOf))
    const { error } = await supabase.from('yt_videos').insert(nouv.map((id, i) => ({ video_id: id, title: titles[i] || '' })))
    setBusy(false); if (error) return toast(friendlyError(error), true)
    const sans = titles.filter((t) => !t).length
    toast(`${nouv.length} vidéo${nouv.length > 1 ? 's' : ''} ajoutée${nouv.length > 1 ? 's' : ''}${deja ? ` · ${deja} déjà présente${deja > 1 ? 's' : ''}` : ''}${sans ? ` · ${sans} titre${sans > 1 ? 's' : ''} à compléter` : ''}`)
    setText(''); setShown(PAGE); await load()
  }
  const rename = async (v, title) => {
    const t = title.trim().slice(0, 200); if (t === (v.title || '')) return
    const { error } = await supabase.from('yt_videos').update({ title: t }).eq('id', v.id); if (error) return toast(friendlyError(error), true)
    setVids(vids.map((x) => (x.id === v.id ? { ...x, title: t } : x)))
  }
  const del = async (v) => {
    if (!window.confirm(`Retirer « ${v.title || v.video_id} » de la liste ? Son lien continue de marcher, mais ses prospects passeront dans « Autres liens YouTube ».`)) return
    const { error } = await supabase.from('yt_videos').delete().eq('id', v.id); if (error) return toast(friendlyError(error), true)
    setVids(vids.filter((x) => x.id !== v.id)); toast('Vidéo retirée')
  }
  const exportAll = () => copyText(list.map((v) => `${v.title || v.video_id}\t${linkOf(v.video_id)}`).join('\n'), toast, `${list.length} lien${list.length > 1 ? 's' : ''} copié${list.length > 1 ? 's' : ''} (titre + lien, à coller dans un tableur)`)

  if (!vids) return <p className="muted">Chargement…</p>
  const rows = list.slice(0, shown)
  return <div className="ev yt">
    <div className="ev-head"><div><h2 className="sh">YouTube</h2><p className="muted">Un lien par vidéo : tu le mets en description, et tu vois combien de prospects, de rendez-vous et de signatures chaque vidéo t'apporte.</p></div></div>
    {!evOk && <p className="rt-card" style={{ borderColor: '#B91C1C', color: '#991B1B' }}>L'événement « YouTube » est introuvable : les liens ci-dessous n'ouvriraient pas la bonne page. Préviens Claude.</p>}
    <div className="ev-stats yt-kpi">{[['Vidéos', vids.length], ['Prospects', total.leads], ['Rendez-vous', total.rdv], ['Appels faits', total.faits], ['Signés', total.signes], ['Taux de closing', pct(total.signes, total.faits)]].map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
    <section className="rt-card">
      <h3 className="rt-h" style={{ marginTop: 0 }}>Ajouter des vidéos</h3>
      <form onSubmit={add}>
        <textarea className="ti" rows={3} placeholder={'Colle un ou plusieurs liens YouTube (un par ligne)\nex. https://www.youtube.com/watch?v=…  ou  https://youtu.be/…'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="acts"><button className="btn" disabled={busy || !text.trim()}>{busy ? 'Ajout…' : 'Ajouter'}</button><span className="muted s12">Le titre se remplit tout seul (tu peux le corriger). Les doublons sont ignorés.</span></div>
      </form>
      <p className="muted s12" style={{ marginTop: 10 }}>Page de réservation pour YouTube : <code>{EVENT_LINK}</code> · mêmes questions et même répartition que le lien en bio TikTok (réglables dans Événements).</p>
    </section>
    <section className="rt-card yt-list">
      <div className="yt-tools"><input className="ti" type="search" placeholder="Rechercher une vidéo…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">{Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span style={{ flex: 1 }} /><button type="button" className="btn ghost sm" onClick={exportAll} disabled={!list.length}>Copier tous les liens</button></div>
      {!vids.length ? <p className="muted" style={{ margin: '14px 0 4px' }}>Aucune vidéo pour l'instant. Colle le lien de ta prochaine vidéo ci-dessus.</p> : <div className="yt-wrap"><table className="yt-tbl">
        <thead><tr><th>Vidéo</th><th className="n">Prospects</th><th className="n">RDV</th><th className="n">Faits</th><th className="n">Signés</th><th className="n">Closing</th><th className="n">CA signé</th><th /></tr></thead>
        <tbody>{rows.map((v) => { const s = st(v.video_id); return <tr key={v.id}>
          <td><div className="yt-v"><a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer"><img src={`https://img.youtube.com/vi/${v.video_id}/mqdefault.jpg`} alt="" loading="lazy" /></a>
            <div><input className="ti yt-t" defaultValue={v.title} placeholder="Titre de la vidéo…" onBlur={(e) => rename(v, e.target.value)} /><small className="muted">Ajoutée le {dshort(v.created_at)} · {v.video_id}</small></div></div></td>
          <td className="n">{s.leads}</td><td className="n">{s.rdv}</td><td className="n">{s.faits}</td><td className="n">{s.signes}</td><td className="n">{pct(s.signes, s.faits)}</td><td className="n">{eur(s.montant)}</td>
          <td className="yt-a"><button type="button" className="btn sm" onClick={() => copyText(linkOf(v.video_id), toast, 'Lien copié : colle-le dans la description de la vidéo')}>Copier le lien</button><button type="button" className="btn ghost sm" onClick={() => del(v)} aria-label="Retirer la vidéo" title="Retirer de la liste">✕</button></td></tr> })}
          {autres.leads > 0 && !q.trim() && <tr className="yt-other"><td><b>Autres liens YouTube</b><br /><small className="muted">Prospects venus de YouTube sans vidéo reconnue (lien sans identifiant, vidéo retirée de la liste…)</small></td><td className="n">{autres.leads}</td><td className="n">{autres.rdv}</td><td className="n">{autres.faits}</td><td className="n">{autres.signes}</td><td className="n">{pct(autres.signes, autres.faits)}</td><td className="n">{eur(autres.montant)}</td><td /></tr>}
        </tbody></table></div>}
      {list.length > shown && <div className="acts" style={{ justifyContent: 'center' }}><button type="button" className="btn ghost" onClick={() => setShown(shown + PAGE)}>Afficher {Math.min(PAGE, list.length - shown)} vidéo{list.length - shown > 1 ? 's' : ''} de plus ({list.length - shown} restante{list.length - shown > 1 ? 's' : ''})</button></div>}
      {!!vids.length && !list.length && <p className="muted" style={{ margin: '14px 0 4px' }}>Aucune vidéo ne correspond à « {q} ».</p>}
    </section>
  </div>
}
