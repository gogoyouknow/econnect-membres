import React from 'react'
import { supabase } from './supabase'

let last = 0
export async function logError(message, stack, extra) {
  try {
    if (Date.now() - last < 2000) return; last = Date.now()
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('client_errors').insert({ user_id: session?.user?.id || null, message: String(message || '').slice(0, 1900), stack: String(stack || '').slice(0, 7900), url: location.href.slice(0, 500), ua: navigator.userAgent.slice(0, 300), extra: extra || null })
  } catch {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', e => logError(e.message, e.error?.stack, { type: 'error' }))
  window.addEventListener('unhandledrejection', e => logError(e.reason?.message || String(e.reason), e.reason?.stack, { type: 'promise' }))
}

export class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { logError(err?.message, (err?.stack || '') + '\n' + (info?.componentStack || ''), { type: 'react' }) }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="crash">
      <div className="crash-card">
        <b>Oups, un petit plantage.</b>
        <p>Rien de perdu. Touche le bouton pour revenir dans l'app ; j'ai noté l'erreur pour la corriger.</p>
        <button className="btn" onClick={() => { try { history.replaceState(null, '', '#general') } catch {} location.reload() }}>Revenir dans l'app</button>
        <small>{String(this.state.err?.message || '').slice(0, 160)}</small>
      </div>
    </div>
  }
}
