import { useEffect, useState } from 'react'
import { rpc } from './api'
import Logo from './Logo'

// /v/<jeton> : compte le clic puis ouvre la vidéo YouTube (ou la page de la Méthode). /stop/<jeton> : désinscription (avec un bouton, pour que les scanners de liens n'agissent pas à ta place).
const [, kind, token] = location.pathname.split('/')

function Click() {
  const [fail, setFail] = useState(false)
  useEffect(() => {
    let off = false
    rpc('mail_click', { p_token: token }).then((u) => { if (!off) location.replace(typeof u === 'string' && u.startsWith('https://') ? u : 'https://www.youtube.com/@theambitiousman') }).catch(() => { if (!off) location.replace('https://www.youtube.com/@theambitiousman') })
    const t = setTimeout(() => setFail(true), 4000)
    return () => { off = true; clearTimeout(t) }
  }, [])
  return <section className="screen"><div className="col"><h2>Je t'ouvre la page…</h2>{fail && <p className="muted"><a href="https://www.youtube.com/@theambitiousman">Si rien ne s'ouvre, clique ici.</a></p>}</div></section>
}

function Stop() {
  const [st, setSt] = useState('ask')
  const go = async () => {
    setSt('busy')
    try { const ok = await rpc('mail_unsub', { p_token: token }); setSt(ok ? 'done' : 'unknown') } catch { setSt('err') }
  }
  return <section className="screen">
    {st === 'done' ? <div className="col"><h2>Tu es désinscrit</h2><p className="muted">Tu ne recevras plus d'emails de ma part. Merci de m'avoir lu.</p></div>
      : st === 'unknown' ? <div className="col"><h2>Lien introuvable</h2><p className="muted">Ce lien n'est plus valable. Si tu continues à recevoir mes emails, réponds-moi simplement « stop ».</p></div>
      : <><div className="col"><h2>Te désinscrire ?</h2><p className="muted">Tu ne recevras plus aucun email automatique de ma part.</p></div>
        {st === 'err' && <p className="err">Un souci est survenu. Réessaie dans un instant.</p>}
        <button className="btn" disabled={st === 'busy'} onClick={go}>{st === 'busy' ? 'Un instant…' : 'Oui, me désinscrire'}</button></>}
  </section>
}

export default function Mail() {
  return <div className="shell"><header><Logo /></header>{kind === 'v' ? <Click /> : <Stop />}</div>
}
