// Copie un texte dans le presse-papiers (avec une solution de secours pour iPhone) puis affiche une confirmation.
export async function copyText(text, toast, msg = 'Copié') {
  const t = String(text || ''); if (!t) return
  try { await navigator.clipboard.writeText(t) } catch {
    try { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(a); a.focus(); a.select(); a.setSelectionRange(0, t.length); document.execCommand('copy'); a.remove() } catch { return toast && toast('Copie impossible', true) }
  }
  toast && toast(msg)
}
