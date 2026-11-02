/**
 * Mesure du visionnage réel d'une vidéo (secondes distinctes lues), quel que soit le lecteur :
 * <video> natif, Bunny (player.js), YouTube (IFrame API), Vimeo (postMessage).
 * onTick({ seconds, duration, pct, position }) est appelé au plus une fois par seconde.
 */
const loaded = {}
function script(src) { return loaded[src] ||= new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = res; document.head.appendChild(s) }) }

export function makeTracker(onTick, initialSeen = []) {
  const seen = new Set(initialSeen)
  let duration = 0, lastTick = 0
  const tick = (t, d) => {
    if (d > 0) duration = d
    const s = Math.floor(t); if (s >= 0 && (duration === 0 || s <= duration + 1)) seen.add(s)
    const now = Date.now(); if (now - lastTick < 1000) return; lastTick = now
    const pct = duration ? Math.min(100, Math.round(seen.size / Math.floor(duration) * 100)) : 0
    onTick({ seconds: seen.size, duration, pct, position: s })
  }
  return { tick, seen }
}

/** <video> natif */
export function attachHtml5(video, tracker) {
  const h = () => tracker.tick(video.currentTime, video.duration || 0)
  video.addEventListener('timeupdate', h); return () => video.removeEventListener('timeupdate', h)
}

/** Bunny Stream (iframe.mediadelivery.net) via player.js */
export async function attachBunny(iframe, tracker) {
  await script('https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js')
  if (!window.playerjs) return () => {}
  const p = new window.playerjs.Player(iframe)
  let dur = 0
  p.on('ready', () => { p.getDuration(d => { dur = d || 0 }) })
  p.on('timeupdate', (e) => tracker.tick(e.seconds, e.duration || dur))
  return () => { try { p.off('timeupdate') } catch {} }
}

/** YouTube via IFrame API : on sonde la position toutes les secondes pendant la lecture */
export async function attachYouTube(el, videoId, tracker) {
  if (!window.YT?.Player) { await script('https://www.youtube.com/iframe_api'); await new Promise(r => { if (window.YT?.Player) r(); else window.onYouTubeIframeAPIReady = r }) }
  let timer = null
  const player = new window.YT.Player(el, { videoId, host: 'https://www.youtube-nocookie.com', playerVars: { rel: 0, modestbranding: 1, playsinline: 1 }, events: {
    onStateChange: (e) => { clearInterval(timer); if (e.data === 1) timer = setInterval(() => tracker.tick(player.getCurrentTime(), player.getDuration()), 1000) },
  } })
  return () => { clearInterval(timer); try { player.destroy() } catch {} }
}

/** Vimeo via postMessage API */
export function attachVimeo(iframe, tracker) {
  const post = (method, value) => iframe.contentWindow?.postMessage(JSON.stringify({ method, value }), 'https://player.vimeo.com')
  const h = (ev) => { if (!/vimeo\.com$/.test(ev.origin)) return; let d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data } catch { return }
    if (d.event === 'ready') post('addEventListener', 'timeupdate')
    if (d.event === 'timeupdate') tracker.tick(d.data.seconds, d.data.duration) }
  window.addEventListener('message', h); setTimeout(() => post('addEventListener', 'timeupdate'), 1500)
  return () => window.removeEventListener('message', h)
}
