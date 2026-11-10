// Ouvre WhatsApp BUSINESS (et pas WhatsApp perso) avec un message déjà écrit.
// iPhone : schéma whatsapp-smb:// (l'app Business). Android : intent vers com.whatsapp.w4b. Ordinateur / secours : wa.me.
export const NURTURE_URL = 'https://rdv.theambitiousman.fr/decouvrir'

export const DEFAULT_MSG = `Salut {prenom}, c'est Clément 👋
C'est bien noté pour notre appel {jour} à {heure}.
Avant qu'on se parle, regarde cette page : tu y trouveras comment j'accompagne mes élèves, leurs témoignages et les réponses aux questions qu'on me pose le plus : {lien}
Réponds-moi juste « OK » pour confirmer que tu seras là.`

export const NURTURE_MSG = `Salut {prenom}, c'est Clément 👋
Avant qu'on se parle, regarde cette page : tu y trouveras comment j'accompagne mes élèves, leurs témoignages et les réponses aux questions qu'on me pose le plus : {lien}
Tu peux aussi y écrire les questions que tu veux me poser, je les lis avant notre appel.`

export const RESCHEDULE_MSG = `Salut {prenom}, c'est Clément. Je dois décaler notre appel : on se retrouve {jour} à {heure}. Dis-moi si ça te va 🙏`

const TZ = 'Europe/Paris'
export const digits = (p) => String(p || '').replace(/[^\d]/g, '')
export const waWeb = (p, text) => { const d = digits(p); return d ? 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '') : '' }

/** Remplit le message modèle : {prenom} {jour} {heure} {lien}. `c` = { first_name, starts_at }. */
export function fillMsg(tpl, c = {}) {
  const d = c.starts_at ? new Date(c.starts_at) : null
  const jour = d ? d.toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }) : ''
  const heure = d ? d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : ''
  return String(tpl || DEFAULT_MSG).replace(/\{prenom\}/g, c.first_name || '').replace(/\{jour\}/g, jour).replace(/\{heure\}/g, heure).replace(/\{lien\}/g, c.qtoken ? NURTURE_URL + '?t=' + c.qtoken : NURTURE_URL).replace(/ +,/g, ',').replace(/Salut ,/, 'Salut,')
}

/** onClick d'un lien : ouvre l'app WhatsApp Business. À utiliser avec href={waWeb(...)} comme secours. */
export function openWA(e, phone, text) {
  const d = digits(phone); if (!d) return
  const q = encodeURIComponent(text || ''); const web = waWeb(phone, text); const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/.test(ua)) {
    e.preventDefault(); const t = Date.now()
    window.location.href = `whatsapp-smb://send?phone=${d}${text ? '&text=' + q : ''}`
    setTimeout(() => { if (!document.hidden && Date.now() - t < 3000) window.location.href = web }, 1300)
  } else if (/Android/.test(ua)) {
    e.preventDefault()
    window.location.href = `intent://send?phone=${d}${text ? '&text=' + q : ''}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(web)};end`
  }
  // ordinateur : le lien wa.me s'ouvre normalement (WhatsApp Web / app de bureau)
}
