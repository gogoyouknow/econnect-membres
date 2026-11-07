import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PAGES = [{ id: 'methode', label: 'Page Méthode E-Connect (97 €)', url: 'https://econnect-membres.vercel.app/methode/' }]
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const dur = (s) => { s = Math.round(s || 0); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s` }
const LABEL = { buy: 'Bouton « Accéder maintenant » (Stripe)', bump_on: 'Accompagnement coché', bump_off: 'Accompagnement décoché', car_prev: 'Témoignages ‹', car_next: 'Témoignages ›' }
const labelOf = (t) => LABEL[t] || (t.startsWith('cta_') ? `Bouton « Oui, je veux… » n°${t.slice(4)}` : t.startsWith('faq_') ? `FAQ ${t.slice(4).replace('_close', ' (fermée)')}` : t.startsWith('link:') ? `Lien ${t.slice(5)}` : t)

function Bar({ label, value, total, sub, hot }) {
  const p = pct(value, total)
  return <div className="abar"><div className="abar-l"><span>{label}</span><b>{value}{total ? <small> · {p} %</small> : null}{sub ? <small> · {sub}</small> : null}</b></div><div className="abar-t"><i style={{ width: `${Math.max(2, p)}%` }} className={hot ? 'hot' : ''} /></div></div>
}

export default function Analytics({ toast }) {
  const [page, setPage] = useState(PAGES[0].id)
  const [days, setDays] = useState(7)
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('analytics_summary', { p_page: page, p_days: days })
    if (error) toast?.(error.message, true); else setD(data)
    setLoading(false)
  }
  useEffect(() => { load() }, [page, days])
  const S = d?.sessions || 0
  const sections = d?.sections || []
  const stops = d?.stops || {}
  const stopTotal = Object.values(stops).reduce((a, b) => a + b, 0)
  const maxDaily = Math.max(1, ...(d?.daily || []).map(x => x.sessions))
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Analytics</h2><small>Chaque visite, chaque scroll, chaque clic sur ta page de vente</small></div>
      <div className="seg">{[7, 14, 30, 90].map(n => <button key={n} className={n === days ? 'on' : ''} onClick={() => setDays(n)}>{n} j</button>)}</div>
      <button className="btn ghost sm" onClick={load}>↻</button>
    </div>
    <div className="body">
      <div className="post" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={page} onChange={e => setPage(e.target.value)}>{PAGES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <a className="muted" href={PAGES.find(p => p.id === page)?.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Ouvrir la page ↗</a>
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Ajoute <code>?utm_source=tiktok&utm_campaign=live</code> à tes liens pour voir d'où viennent les gens.</span>
      </div>
      {loading && !d ? <div className="center">Chargement…</div> : !d ? null : <>
        <div className="kpis">
          <div className="kpi"><small>Visiteurs</small><b>{d.visitors}</b><span>{S} visites</span></div>
          <div className="kpi"><small>Temps médian</small><b>{dur(d.median_time)}</b><span>moy. {dur(d.avg_time)}</span></div>
          <div className="kpi"><small>Rebond</small><b>{pct(d.bounce, S)} %</b><span>&lt; 10 s sans scroller</span></div>
          <div className="kpi"><small>Clic « Oui, je veux… »</small><b className="gold">{pct(d.cta_sessions, S)} %</b><span>{d.cta_sessions} visites</span></div>
          <div className="kpi"><small>Clic Stripe</small><b className="gold">{pct(d.buy_sessions, S)} %</b><span>{d.buy_sessions} visites</span></div>
          <div className="kpi"><small>Achats</small><b className="gold">{d.purchases}</b><span>{pct(d.purchases, S)} % des visites</span></div>
        </div>

        <div className="post">
          <b>Jusqu'où les gens descendent</b>
          <p className="muted" style={{ fontSize: 12 }}>Part des visites qui atteignent chaque profondeur de la page.</p>
          {['25', '50', '75', '90', '100'].map(k => <Bar key={k} label={`${k} % de la page`} value={d.scroll?.[k] || 0} total={S} />)}
        </div>

        <div className="post">
          <b>Section par section : vue et temps passé</b>
          <p className="muted" style={{ fontSize: 12 }}>Part des visites qui ont vu chaque section (au moins 0,7 s) et temps moyen dessus. La chute entre deux lignes = là où tu perds des gens.</p>
          {sections.map(s => <Bar key={s.n} label={`${s.n}. ${s.name}`} value={s.seen} total={S} sub={`${s.dwell || 0} s`} />)}
          {!sections.length && <p className="muted">Pas encore de données.</p>}
        </div>

        <div className="post">
          <b>Où ils s'arrêtent</b>
          <p className="muted" style={{ fontSize: 12 }}>Dernière section à l'écran au moment où ils quittent la page.</p>
          {Object.entries(stops).sort((a, b) => b[1] - a[1]).map(([n, c]) => <Bar key={n} label={`${n}. ${sections.find(s => String(s.n) === n)?.name || 'section ' + n}`} value={c} total={stopTotal} hot />)}
          {!stopTotal && <p className="muted">Pas encore de données.</p>}
        </div>

        <div className="post">
          <b>Clics</b>
          {Object.entries(d.clicks || {}).map(([t, c]) => <Bar key={t} label={labelOf(t)} value={c} total={S} hot={t === 'buy'} />)}
          {!Object.keys(d.clicks || {}).length && <p className="muted">Aucun clic enregistré.</p>}
          {!!d.bump_sessions && <p className="muted" style={{ fontSize: 12 }}>Accompagnement 160 €/mois coché dans {d.bump_sessions} visite(s).</p>}
        </div>

        <div className="grid2">
          <div className="post"><b>Par jour</b>
            <div className="spark">{(d.daily || []).map(x => <div key={x.d} title={`${x.d} · ${x.sessions} visites · ${x.buy} clics Stripe`}><i style={{ height: `${Math.max(4, (x.sessions / maxDaily) * 100)}%` }} />{x.buy ? <em style={{ height: `${(x.buy / maxDaily) * 100}%` }} /> : null}<small>{x.d.slice(8)}</small></div>)}</div>
            <p className="muted" style={{ fontSize: 11 }}>Barre = visites · trait or = clics Stripe</p>
          </div>
          <div className="post"><b>D'où ils viennent</b>
            {(d.sources || []).map((s, i) => <Bar key={i} label={`${s.src}${s.camp ? ' · ' + s.camp : ''}`} value={s.sessions} total={S} sub={s.buy ? `${s.buy} clic(s) Stripe` : null} />)}
            <div style={{ marginTop: 8 }}>{Object.entries(d.devices || {}).map(([k, v]) => <span key={k} className="pill" style={{ marginRight: 6 }}>{k === 'mobile' ? '📱' : '💻'} {k} {pct(v, S)} %</span>)}</div>
          </div>
        </div>

        <div className="post"><b>Derniers événements</b>
          <table className="tbl"><tbody>{(d.last_events || []).map((e, i) => <tr key={i}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>{e.e === 'view' ? `👁 arrivée (${e.d.device || ''}${e.d.utm_source ? ' · ' + e.d.utm_source : e.d.ref_host ? ' · ' + e.d.ref_host : ''})` : e.e === 'click' ? `👆 ${labelOf(e.d.t || '')}` : `🚪 sortie après ${dur(e.d.t)} · ${e.d.max_depth || 0} % de la page`}</td><td className="muted">{e.sid}</td></tr>)}</tbody></table>
        </div>
      </>}
    </div>
  </>
}
