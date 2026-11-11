// Ouvre directement l'app WhatsApp avec le message prêt, sans passer par la page web « Ouvrir l'application ».
// iPhone : schéma whatsapp:// (marche aussi depuis le navigateur intégré de TikTok / Instagram). Android : intent (WhatsApp ou WhatsApp Business).
// Si l'app ne s'ouvre pas, on retombe sur le lien wa.me classique.
export function openChat(e, num, text, web) {
  const d = String(num || '').replace(/\D/g, ''); if (!d) return
  const q = text ? '&text=' + encodeURIComponent(text) : ''; const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/.test(ua)) {
    // Ouverture directe de l'app, sans passer par la page wa.me (pas de repli automatique : le lien « Écris-moi au … » reste dispo).
    e.preventDefault()
    window.location.href = `whatsapp://send?phone=${d}${q}`
  } else if (/Android/.test(ua)) {
    e.preventDefault()
    window.location.href = `intent://send?phone=${d}${q}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(web)};end`
  }
}
