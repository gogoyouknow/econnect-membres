// Assistant IA de Calio : répond aux questions (lecture seule) et PROPOSE des actions (contact, rendez-vous, règles de répartition, horaires, statuts, montants…).
// Rien n'est écrit ici : chaque action s'affiche en carte, et c'est l'app qui l'exécute avec la session de l'admin, après son tap sur « Confirmer ».
const URL = Deno.env.get('SUPABASE_URL')!
const SKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL = 'claude-sonnet-5-5'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json' }

const sel = async (path: string) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`)
  return await r.json()
}
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const parisDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
const parisNow = () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' }).format(new Date())
const hm = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const clean = (s: unknown) => String(s ?? '').replace(/[*,()%]/g, ' ').trim().slice(0, 60)

const CAPL: Record<string, string> = { lt500: 'moins de 500 €', '500-1000': '500 à 1 000 €', '1000-3000': '1 000 à 3 000 €', gt3000: 'plus de 3 000 €' }

const TOOLS = [
  { name: 'chercher_prospects', description: "Cherche des prospects dans Calio (une fiche par personne). Filtres facultatifs. Renvoie les plus récents d'abord. Statuts (stage) : rdv = appel prévu, qualifie, potentiel, incomplet, disqualifie (moins de 500 € ou budget pas disponible), fait, absent, annule.",
    input_schema: { type: 'object', properties: { texte: { type: 'string', description: 'prénom, nom, email ou numéro (partiel)' }, stage: { type: 'string', enum: ['rdv', 'qualifie', 'potentiel', 'incomplet', 'disqualifie', 'fait', 'absent', 'annule'] }, jours: { type: 'integer', description: 'ne garder que les fiches créées depuis N jours' }, limite: { type: 'integer', description: 'max 15, défaut 8' } } } },
  { name: 'appels', description: 'Liste les appels réservés entre deux dates (heure de Paris, format AAAA-MM-JJ, bornes incluses).',
    input_schema: { type: 'object', properties: { du: { type: 'string' }, au: { type: 'string' } }, required: ['du', 'au'] } },
  { name: 'statistiques', description: "Chiffres sur les N derniers jours : fiches créées, par statut, appels réservés, relances automatiques envoyées.",
    input_schema: { type: 'object', properties: { jours: { type: 'integer', description: 'défaut 7' } } } },
  { name: 'proposer_contact', description: "Prépare la création d'un contact à partir d'infos données par l'utilisateur. N'écrit RIEN : affiche une fiche que l'utilisateur doit confirmer. Exige un prénom et au moins un numéro ou un email.",
    input_schema: { type: 'object', properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, situation: { type: 'string', enum: ['Salarié', 'Étudiant', 'Entrepreneur', 'Sans activité'] }, experience: { type: 'string', enum: ['Jamais vendu en ligne', 'Quelques ventes', 'Boutique active'] }, capital: { type: 'string', enum: ['lt500', '500-1000', '1000-3000', 'gt3000'] }, source: { type: 'string' }, note: { type: 'string' } }, required: ['first_name'] } },
  { name: 'proposer_rdv', description: "Prépare la prise d'un rendez-vous (appel) pour un prospect, à la date et l'heure demandées, MÊME si ce créneau n'est pas dans les disponibilités : le rendez-vous est posé quand même et le créneau s'ouvre de fait. N'écrit RIEN : affiche une carte que Clément confirme d'un tap. Donne la date en AAAA-MM-JJ et l'heure en HH:MM (heure de Paris), calculées à partir de la date du jour.",
    input_schema: { type: 'object', properties: { first_name: { type: 'string', description: 'prénom du prospect' }, texte: { type: 'string', description: 'nom, téléphone ou email pour retrouver une fiche existante' }, phone: { type: 'string' }, email: { type: 'string' }, date: { type: 'string', description: 'AAAA-MM-JJ' }, heure: { type: 'string', description: 'HH:MM, 24h, heure de Paris' }, closer: { type: 'string', description: 'qui prend l\'appel (clement par défaut)' }, minutes: { type: 'number' } }, required: ['date', 'heure'] } },
  { name: 'configuration', description: "Lit la configuration actuelle de Calio : événements (liens de réservation) avec leurs règles de répartition et priorités des closers, closers (actif ou non), réglages de réservation, horaires et jours off de chaque closer, étapes de la séquence de confirmation. À appeler AVANT toute action de réglage pour connaître l'état actuel et les identifiants.",
    input_schema: { type: 'object', properties: {} } },
  { name: 'proposer_action', description: "Prépare une ACTION à faire dans Calio. N'écrit RIEN : affiche une carte que Clément confirme d'un tap. Une action par appel. Arguments selon l'action :\n" +
    "- regle_ajouter : event, closer, budget (liste parmi lt500, 500-1000, 1000-3000, gt3000), situation (liste parmi Salarié, Étudiant, Entrepreneur, Sans activité), source (texte contenu dans l'origine), position ('debut' par défaut ou 'fin'). Une règle envoie les appels qui correspondent à CE closer ; la première règle qui correspond gagne.\n" +
    "- regle_supprimer : event, numero (n° de la règle, voir configuration).\n" +
    "- priorite_closer : event, closer, prio (haute | moyenne | basse | off). Sert à répartir les appels qui ne correspondent à aucune règle.\n" +
    "- closer_actif : closer, actif (true/false).\n" +
    "- reglage : champ (slot_min = durée d'un appel en minutes, step_min = pas entre deux créneaux, notice_min = délai minimum avant un créneau en minutes, horizon_days = jours réservables à l'avance, release_hours = heures avant libération sans message WhatsApp, from_tomorrow = true/false pas de rendez-vous le jour même), valeur.\n" +
    "- horaires_semaine : closer, jours = liste COMPLÈTE de {jour (lundi…dimanche), debut 'HH:MM', fin 'HH:MM'} : remplace TOUTE la semaine du closer (reprends les horaires existants de la configuration et ajoute/retire ce qui est demandé).\n" +
    "- jour_closer : closer, date (AAAA-MM-JJ), mode ('off' = indisponible ce jour, 'plages' = horaires précis ce jour avec plages [{debut,fin}], 'normal' = revenir à la semaine type).\n" +
    "- appel_statut : id_appel, statut (confirme | fait | absent | annule).\n" +
    "- appel_deplacer : id_appel, date (AAAA-MM-JJ), heure (HH:MM).\n" +
    "- appel_closer : id_appel, closer (qui prend l'appel).\n" +
    "- appel_resultat : id_appel, resultat (signe | perdu | reflechit | aucun), montant (euros, seulement si signe, facultatif).\n" +
    "- fiche_note : id_fiche, note (texte AJOUTÉ à la note existante).\n" +
    "- fiche_relance : id_fiche, suivi (new = à relancer | done = déjà relancé | skip = écarté).\n" +
    "- etape_sequence : id_etape, champ (active | minutes | subject | body), valeur. Étapes de la séquence de confirmation (messages avant/après le rendez-vous).\n" +
    "- bloquer : id_fiche, raison (no_show | silence | autre), note : bloque cette personne (email, téléphone, IP) et annule ses appels à venir.",
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['regle_ajouter', 'regle_supprimer', 'priorite_closer', 'closer_actif', 'reglage', 'horaires_semaine', 'jour_closer', 'appel_statut', 'appel_deplacer', 'appel_closer', 'appel_resultat', 'fiche_note', 'fiche_relance', 'etape_sequence', 'bloquer'] }, args: { type: 'object', description: 'les arguments de l\'action, voir la description' } }, required: ['action', 'args'] } },
]

// 'AAAA-MM-JJ' + 'HH:MM' (heure de Paris) -> instant ISO UTC, en tenant compte de l'heure d'été
const parisToISO = (d: string, t: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d), h = /^(\d{1,2})[:h](\d{2})?$/.exec(t.trim())
  if (!m || !h) return null
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +(h[2] ?? 0))
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(utc))
  const g = (k: string) => +(parts.find((x) => x.type === k)?.value ?? 0)
  const asParis = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'))
  return new Date(utc - (asParis - utc)).toISOString()
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const BUD = ['lt500', '500-1000', '1000-3000', 'gt3000']
const SITS = ['Salarié', 'Étudiant', 'Entrepreneur', 'Sans activité']
const strip = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const hhmm = (x: unknown) => { const m = /^(\d{1,2})[:h](\d{2})?$/.exec(String(x ?? '').trim()); if (!m) return null; const h = +m[1], mi = +(m[2] ?? 0); return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null }
const isDate = (x: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ''))
const budL = (l: unknown) => (Array.isArray(l) && l.length ? l.map((b) => CAPL[String(b)] ?? String(b)).join(' ou ') : 'tous les budgets')

async function findEvent(ref: unknown) {
  const r = strip(String(ref ?? 'principal'))
  const ev = await sel('cand_events?select=id,slug,name,main,active,pool,rules&order=main.desc')
  return ev.find((e: Record<string, unknown>) => String(e.id) === r || strip(String(e.slug ?? '')) === r || strip(String(e.name)) === r || (e.main && ['principal', 'lien principal', 'main', ''].includes(r))) ?? ev.find((e: Record<string, unknown>) => strip(String(e.name)).includes(r)) ?? null
}
async function findCloser(ref: unknown) {
  const r = strip(String(ref ?? '')); if (!r) return null
  const cl = await sel('cand_closers?select=key,name,active')
  return cl.find((c: Record<string, unknown>) => strip(String(c.key)) === r || strip(String(c.name)) === r) ?? null
}

async function proposeAction(action: string, a: Record<string, unknown>, proposals: Record<string, unknown>[]): Promise<unknown> {
  const add = (args: Record<string, unknown>, title: string, lines: string[], danger = false) => {
    proposals.push({ kind: 'action', action, args, title, lines, danger })
    return { ok: true, statut: 'carte affichée à Clément, EN ATTENTE de sa confirmation (rien n’est encore modifié)' }
  }
  const err = (e: string) => ({ erreur: e })
  if (action === 'regle_ajouter') {
    const ev = await findEvent(a.event); if (!ev) return err('événement introuvable : appelle configuration')
    const c = await findCloser(a.closer); if (!c) return err('closer introuvable : appelle configuration')
    const capital = (Array.isArray(a.budget) ? a.budget : []).map(String).filter((b) => BUD.includes(b))
    const situation = (Array.isArray(a.situation) ? a.situation : []).map(String).filter((b) => SITS.includes(b))
    const source = String(a.source ?? '').trim().slice(0, 40)
    if (!capital.length && !situation.length && !source) return err('une règle sans condition enverrait TOUS les appels à ce closer : demande la condition (budget, situation ou origine)')
    const position = a.position === 'fin' ? 'fin' : 'debut'
    return add({ event_id: ev.id, closer: c.key, capital, situation, source, position }, 'Nouvelle règle de répartition',
      [`Événement : ${ev.main ? 'lien principal' : ev.name}`, `Quand : budget ${budL(capital)}${situation.length ? ` · situation ${situation.join(' ou ')}` : ''}${source ? ` · origine contenant « ${source} »` : ''}`, `Alors l’appel va à : ${c.name}`, position === 'fin' ? 'Placée en dernier (les règles au-dessus passent avant)' : 'Placée en premier (elle passe avant les autres)'])
  }
  if (action === 'regle_supprimer') {
    const ev = await findEvent(a.event); if (!ev) return err('événement introuvable')
    const n = Number(a.numero); const r = (ev.rules as Record<string, unknown>[] ?? [])[n - 1]; if (!r) return err('numéro de règle introuvable : appelle configuration')
    return add({ event_id: ev.id, numero: n, closer: r.closer }, 'Supprimer une règle', [`Événement : ${ev.main ? 'lien principal' : ev.name}`, `Règle ${n} : budget ${budL(r.capital)}${(r.situation as unknown[])?.length ? ` · situation ${(r.situation as string[]).join(' ou ')}` : ''}${r.source ? ` · origine « ${r.source} »` : ''} → ${r.closer}`], true)
  }
  if (action === 'priorite_closer') {
    const ev = await findEvent(a.event); if (!ev) return err('événement introuvable')
    const c = await findCloser(a.closer); if (!c) return err('closer introuvable')
    const prio = String(a.prio ?? ''); if (!['haute', 'moyenne', 'basse', 'off'].includes(prio)) return err('priorité : haute, moyenne, basse ou off')
    return add({ event_id: ev.id, closer: c.key, prio }, 'Priorité d’un closer', [`Événement : ${ev.main ? 'lien principal' : ev.name}`, `${c.name} : priorité ${prio === 'off' ? 'désactivée (ne reçoit plus d’appels par priorité)' : prio}`])
  }
  if (action === 'closer_actif') {
    const c = await findCloser(a.closer); if (!c) return err('closer introuvable')
    const actif = a.actif === true || a.actif === 'true'
    return add({ closer: c.key, actif }, actif ? 'Réactiver un closer' : 'Désactiver un closer', [`${c.name} ${actif ? 'peut de nouveau recevoir des appels' : 'ne recevra plus aucun nouvel appel'}`], !actif)
  }
  if (action === 'reglage') {
    const LAB: Record<string, string> = { slot_min: 'Durée d’un appel (min)', step_min: 'Pas entre deux créneaux (min)', notice_min: 'Délai minimum avant un créneau (min)', horizon_days: 'Jours réservables à l’avance', release_hours: 'Libération sans message WhatsApp (heures)', from_tomorrow: 'Pas de rendez-vous le jour même' }
    const champ = String(a.champ ?? ''); if (!LAB[champ]) return err('réglage inconnu')
    let v: unknown = a.valeur
    if (champ === 'from_tomorrow') v = v === true || v === 'true' || v === 'oui'
    else { v = Math.round(Number(v)); if (!Number.isFinite(v as number) || (v as number) < 0 || (v as number) > 100000) return err('valeur invalide') }
    return add({ champ, valeur: v }, 'Réglage de réservation', [`${LAB[champ]} : ${champ === 'from_tomorrow' ? (v ? 'oui' : 'non') : v}`])
  }
  if (action === 'horaires_semaine') {
    const c = await findCloser(a.closer); if (!c) return err('closer introuvable')
    const jours: { weekday: number; start: string; end: string }[] = []
    for (const j of (Array.isArray(a.jours) ? a.jours : []) as Record<string, unknown>[]) {
      const wd = JOURS.indexOf(strip(String(j.jour ?? ''))), d = hhmm(j.debut), f = hhmm(j.fin)
      if (wd < 0 || !d || !f || f <= d) return err('jour ou horaire invalide (jour en toutes lettres, HH:MM, fin après début)')
      jours.push({ weekday: wd, start: d, end: f })
    }
    jours.sort((x, y) => ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7) || x.start.localeCompare(y.start))
    return add({ closer: c.key, jours }, `Horaires de la semaine de ${c.name}`, jours.length ? jours.map((j) => `${JOURS[j.weekday]} : ${j.start} – ${j.end}`) : ['Aucun horaire : plus aucun créneau propre à ce closer'], !jours.length)
  }
  if (action === 'jour_closer') {
    const c = await findCloser(a.closer); if (!c) return err('closer introuvable')
    if (!isDate(a.date)) return err('date invalide (AAAA-MM-JJ)')
    const mode = String(a.mode ?? ''); if (!['off', 'plages', 'normal'].includes(mode)) return err('mode : off, plages ou normal')
    const plages: { start: string; end: string }[] = []
    if (mode === 'plages') for (const p of (Array.isArray(a.plages) ? a.plages : []) as Record<string, unknown>[]) { const d = hhmm(p.debut), f = hhmm(p.fin); if (!d || !f || f <= d) return err('plage invalide'); plages.push({ start: d, end: f }) }
    if (mode === 'plages' && !plages.length) return err('aucune plage donnée')
    const wd = JOURS[new Date(`${a.date}T12:00:00Z`).getUTCDay()]
    return add({ closer: c.key, date: a.date, mode, plages }, `${wd} ${a.date} · ${c.name}`, [mode === 'off' ? 'Indisponible toute la journée' : mode === 'normal' ? 'Retour aux horaires de la semaine type' : plages.map((p) => `${p.start} – ${p.end}`).join(' · ')])
  }
  if (['appel_statut', 'appel_deplacer', 'appel_closer', 'appel_resultat'].includes(action)) {
    const rows = await sel(`candidatures?select=id,first_name,starts_at,status,closer,outcome,signed_amount&id=eq.${Number(a.id_appel) || 0}`)
    const c = rows[0]; if (!c) return err('appel introuvable : appelle appels pour retrouver l’id_appel')
    const who = `${c.first_name} · ${hm(c.starts_at)}`
    if (action === 'appel_statut') {
      const st = String(a.statut ?? ''); if (!['confirme', 'fait', 'absent', 'annule'].includes(st)) return err('statut : confirme, fait, absent ou annule')
      return add({ id: c.id, statut: st }, 'Statut d’un appel', [who, `${c.status} → ${st}`], st === 'annule')
    }
    if (action === 'appel_deplacer') {
      const iso = parisToISO(String(a.date ?? ''), String(a.heure ?? '')); if (!iso) return err('date ou heure invalide')
      if (new Date(iso).getTime() < Date.now() - 60000) return err('ce moment est déjà passé')
      const pris = await sel(`candidatures?select=first_name&starts_at=eq.${encodeURIComponent(iso)}&status=in.(reserve,confirme)&id=neq.${c.id}&limit=1`)
      if (pris.length) return err(`ce créneau est déjà pris par ${pris[0].first_name}`)
      return add({ id: c.id, starts_at: iso }, 'Déplacer un appel', [c.first_name, `${hm(c.starts_at)} → ${hm(iso)}`, 'Aucun message n’est envoyé au prospect'])
    }
    if (action === 'appel_closer') {
      const cl = await findCloser(a.closer); if (!cl) return err('closer introuvable')
      return add({ id: c.id, closer: cl.key }, 'Changer le closer d’un appel', [who, `${c.closer} → ${cl.name}`])
    }
    const res = String(a.resultat ?? ''); if (!['signe', 'perdu', 'reflechit', 'aucun'].includes(res)) return err('résultat : signe, perdu, reflechit ou aucun')
    let montant: number | null = null
    if (res === 'signe' && a.montant != null && a.montant !== '') { montant = Number(String(a.montant).replace(',', '.')); if (!Number.isFinite(montant) || montant < 0 || montant > 100000) return err('montant invalide (100 000 € maximum)') }
    return add({ id: c.id, resultat: res, montant }, 'Résultat d’un appel', [who, res === 'signe' ? `Signé${montant != null ? ` · ${montant} €` : ' · montant non précisé'}` : res === 'perdu' ? 'Perdu' : res === 'reflechit' ? 'Réfléchit' : 'Résultat effacé'])
  }
  if (action === 'fiche_note' || action === 'fiche_relance' || action === 'bloquer') {
    const rows = await sel(`cand_leads?select=id,first_name,last_name,note,follow&id=eq.${Number(a.id_fiche) || 0}`)
    const l = rows[0]; if (!l) return err('fiche introuvable : appelle chercher_prospects pour retrouver l’id_fiche')
    const nm = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Sans prénom'
    if (action === 'fiche_note') {
      const note = String(a.note ?? '').trim().slice(0, 1000); if (!note) return err('note vide')
      return add({ id: l.id, note: [l.note, note].filter(Boolean).join('\n') }, 'Note sur une fiche', [nm, note])
    }
    if (action === 'fiche_relance') {
      const sv = String(a.suivi ?? ''); if (!['new', 'done', 'skip'].includes(sv)) return err('suivi : new, done ou skip')
      return add({ id: l.id, suivi: sv }, 'Suivi d’une fiche', [nm, sv === 'new' ? 'À relancer' : sv === 'done' ? 'Déjà relancé' : 'Écarté (plus de relance)'])
    }
    const raison = ['no_show', 'silence', 'autre'].includes(String(a.raison)) ? String(a.raison) : 'autre'
    return add({ id: l.id, raison, note: String(a.note ?? '').slice(0, 300) }, 'Bloquer une personne', [nm, 'Son email, son téléphone et son IP seront bloqués, ses appels à venir annulés', `Raison : ${raison}`], true)
  }
  if (action === 'etape_sequence') {
    const rows = await sel(`cand_cseq?select=id,label,channel&id=eq.${Number(a.id_etape) || 0}`)
    const e = rows[0]; if (!e) return err('étape introuvable : appelle configuration')
    const champ = String(a.champ ?? ''); if (!['active', 'minutes', 'subject', 'body'].includes(champ)) return err('champ : active, minutes, subject ou body')
    let v: unknown = a.valeur
    if (champ === 'active') v = v === true || v === 'true' || v === 'oui'
    else if (champ === 'minutes') { v = Math.round(Number(v)); if (!Number.isFinite(v as number) || (v as number) < 0 || (v as number) > 20000) return err('minutes invalides') }
    else { v = String(v ?? '').slice(0, 6000); if (!String(v).trim()) return err('texte vide') }
    return add({ id: e.id, champ, valeur: v }, `Séquence de confirmation · ${e.label}`, [champ === 'active' ? (v ? 'Activer cette étape' : 'Désactiver cette étape') : champ === 'minutes' ? `Délai : ${v} min` : champ === 'subject' ? `Nouvel objet : ${v}` : `Nouveau texte : ${String(v).slice(0, 300)}`])
  }
  return err('action inconnue')
}

async function runTool(name: string, a: Record<string, unknown>, proposals: Record<string, unknown>[]): Promise<unknown> {
  if (name === 'chercher_prospects') {
    const lim = Math.min(Math.max(Number(a.limite) || 8, 1), 15)
    let q = `prospects_v?select=id,first_name,last_name,stage,situation,experience,blocage,capital,budget_confirmed,step,follow,source,created_at,call_at,call_status,phone,email&order=created_at.desc&limit=${lim}`
    if (a.stage) q += `&stage=eq.${clean(a.stage)}`
    if (a.jours) q += `&created_at=gte.${new Date(Date.now() - Number(a.jours) * 864e5).toISOString()}`
    const t = clean(a.texte)
    if (t) q += `&or=(first_name.ilike.*${t}*,last_name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t.replace(/\s/g, '')}*)`
    const rows = await sel(q)
    const keepContact = rows.length <= 5
    return rows.map((r: Record<string, string>) => ({
      id_fiche: r.id, nom: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans prénom', statut: r.stage, situation: r.situation, experience: r.experience,
      bloque_sur: r.blocage ? String(r.blocage).slice(0, 300) : null, budget: CAPL[r.capital] ?? null, budget_confirme: r.budget_confirmed, derniere_etape: r.step,
      relance: r.follow === 'done' ? 'déjà relancé' : r.follow === 'skip' ? 'écarté' : 'à relancer', source: r.source, cree_le: hm(r.created_at),
      appel: r.call_at ? `${hm(r.call_at)} (${r.call_status})` : null, ...(keepContact ? { whatsapp: r.phone, email: r.email } : {}),
    }))
  }
  if (name === 'appels') {
    const du = clean(a.du), au = clean(a.au)
    const rows = await sel(`candidatures?select=id,first_name,starts_at,status,situation,capital,closer,outcome,signed_amount&starts_at=gte.${du}T00:00:00%2B01:00&starts_at=lt.${au}T23:59:59%2B01:00&order=starts_at.asc&limit=60`)
    return rows.map((r: Record<string, string>) => ({ id_appel: r.id, prenom: r.first_name, quand: hm(r.starts_at), statut: r.status, situation: r.situation, budget: CAPL[r.capital] ?? null, closer: r.closer, resultat: r.outcome ?? null, montant_signe: r.signed_amount ?? null }))
  }
  if (name === 'statistiques') {
    const j = Math.min(Math.max(Number(a.jours) || 7, 1), 90)
    const since = new Date(Date.now() - j * 864e5).toISOString()
    const rows = await sel(`prospects_v?select=stage,created_at&created_at=gte.${since}&limit=5000`)
    const by: Record<string, number> = {}; for (const r of rows) by[r.stage] = (by[r.stage] ?? 0) + 1
    const calls = await sel(`candidatures?select=id&created_at=gte.${since}&limit=5000`)
    const rel = await sel(`cand_leads?select=id&auto_sent_at=gte.${since}&limit=5000`)
    return { jours: j, fiches_creees: rows.length, par_statut: by, appels_reserves: calls.length, relances_auto_envoyees: rel.length }
  }
  if (name === 'proposer_contact') {
    const p = { ...a }
    if (!String(p.first_name ?? '').trim()) return { erreur: 'prénom manquant : demande-le à l’utilisateur' }
    if (!String(p.phone ?? '').trim() && !String(p.email ?? '').trim()) return { erreur: 'il faut un numéro ou un email : demande-le à l’utilisateur' }
    proposals.push(p)
    return { ok: true, statut: 'fiche affichée à l’utilisateur, EN ATTENTE de sa confirmation (rien n’est encore créé)' }
  }
  if (name === 'proposer_rdv') {
    const iso = parisToISO(String(a.date ?? ''), String(a.heure ?? ''))
    if (!iso) return { erreur: 'date ou heure invalide : demande-la à l’utilisateur (AAAA-MM-JJ et HH:MM)' }
    if (new Date(iso).getTime() < Date.now() - 60000) return { erreur: 'ce moment est déjà passé : redemande la date' }
    let first = String(a.first_name ?? '').trim(), phone = String(a.phone ?? '').trim(), email = String(a.email ?? '').trim()
    let extra: Record<string, unknown> = {}, trouve: unknown = null
    const t = clean(a.texte || a.first_name)
    if (t) {
      const rows = await sel(`prospects_v?select=first_name,last_name,phone,email,situation,capital,budget_confirmed,stage&or=(first_name.ilike.*${t}*,last_name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t.replace(/\s/g, '')}*)&order=created_at.desc&limit=4`)
      if (rows.length > 1 && !phone && !email) return { erreur: 'plusieurs prospects correspondent, demande lequel (nom complet, numéro ou email)', candidats: rows.map((r: Record<string, string>) => [r.first_name, r.last_name].filter(Boolean).join(' ')) }
      if (rows.length === 1) { const r = rows[0]; trouve = [r.first_name, r.last_name].filter(Boolean).join(' '); first = first || r.first_name; phone = phone || r.phone || ''; email = email || r.email || ''; extra = { situation: r.situation ?? null, capital: r.capital ?? null, budget_confirmed: r.budget_confirmed ?? null } }
    }
    if (!first) return { erreur: 'prénom manquant : demande-le à l’utilisateur' }
    if (!phone && !email) return { erreur: 'aucune fiche trouvée et pas de numéro ni d’email : demande-les à l’utilisateur' }
    const cl = await sel('cand_closers?select=key,name,active')
    const want = clean(a.closer || 'clement').toLowerCase()
    const c = cl.find((x: Record<string, string>) => x.key === want || String(x.name).toLowerCase() === want) ?? cl.find((x: Record<string, string>) => x.key === 'clement')
    if (!c) return { erreur: 'closer introuvable' }
    const set = await sel('cand_settings?select=slot_min&id=eq.1')
    const minutes = Math.min(Math.max(Number(a.minutes) || Number(set[0]?.slot_min) || 45, 10), 180)
    const pris = await sel(`candidatures?select=first_name&starts_at=eq.${encodeURIComponent(iso)}&closer=eq.${c.key}&status=neq.annule&limit=1`)
    if (pris.length) return { erreur: `ce créneau est déjà pris par ${pris[0].first_name} avec ${c.name} : propose une autre heure` }
    proposals.push({ kind: 'rdv', first_name: first, phone, email, starts_at: iso, minutes, closer: c.key, closer_name: c.name, ...extra })
    return { ok: true, fiche_existante: trouve, statut: 'carte affichée à l’utilisateur, EN ATTENTE de sa confirmation (rien n’est encore réservé)', quand: hm(iso), avec: c.name }
  }
  if (name === 'configuration') {
    const [ev, cl, st, hrs, ovr, blk, seq] = await Promise.all([
      sel('cand_events?select=id,slug,name,main,active,pool,rules&order=main.desc,created_at'),
      sel('cand_closers?select=key,name,active&order=key'),
      sel('cand_settings?select=slot_min,step_min,notice_min,horizon_days,release_hours,from_tomorrow&id=eq.1'),
      sel('cand_closer_hours?select=closer,weekday,start_time,end_time&order=closer,weekday,start_time').catch(() => []),
      sel(`cand_closer_overrides?select=closer,day,start_time,end_time&day=gte.${parisDay(new Date())}&order=day`).catch(() => []),
      sel(`cand_closer_blocked?select=closer,day&day=gte.${parisDay(new Date())}&order=day`).catch(() => []),
      sel('cand_cseq?select=id,label,anchor,minutes,channel,active,cond,subject&order=pos').catch(() => []),
    ])
    const hh = (t: string) => String(t).slice(0, 5)
    const horaires: Record<string, unknown[]> = {}; for (const h of hrs) (horaires[h.closer] ??= []).push({ jour: JOURS[h.weekday], debut: hh(h.start_time), fin: hh(h.end_time) })
    return {
      evenements: ev.map((e: Record<string, unknown>) => ({ id: e.id, lien: e.main ? 'principal' : e.slug, nom: e.name, actif: e.active,
        priorites: ((e.pool as Record<string, string>[]) ?? []).map((p) => ({ closer: p.closer, prio: p.prio })),
        regles: ((e.rules as Record<string, unknown>[]) ?? []).map((r, i) => ({ numero: i + 1, closer: r.closer, budget: r.capital ?? [], situation: r.situation ?? [], source: r.source ?? '' })) })),
      closers: cl.map((c: Record<string, unknown>) => ({ key: c.key, nom: c.name, actif: c.active })),
      reglages: st[0] ?? null,
      horaires_semaine_des_closers: horaires,
      jours_speciaux_a_venir: ovr.map((o: Record<string, string>) => ({ closer: o.closer, date: o.day, debut: hh(o.start_time), fin: hh(o.end_time) })),
      jours_off_a_venir: blk.map((b: Record<string, string>) => ({ closer: b.closer, date: b.day })),
      etapes_sequence_confirmation: seq,
    }
  }
  if (name === 'proposer_action') return await proposeAction(String(a.action ?? ''), (a.args ?? {}) as Record<string, unknown>, proposals)
  return { erreur: 'outil inconnu' }
}

const SYSTEM = () => `Tu es l'assistant de Clément dans Calio, son app de prise de rendez-vous et de suivi des prospects (accompagnement e-commerce).
Nous sommes le ${parisNow()} (heure de Paris).
Tu réponds en français, court et direct, comme un collègue : une ou deux phrases, puis les chiffres ou la liste utile. Tutoie Clément.
Tu ne réponds QUE à partir des outils : ne devine jamais un chiffre ni un prospect. Si l'outil ne renvoie rien, dis-le simplement.
Définitions : « qualifié » = a indiqué 500 € ou plus ; « disqualifié » = moins de 500 € ou budget pas disponible maintenant ; « à relancer » = qualifié, pas encore relancé.
Pour créer un contact, appelle proposer_contact avec ce que Clément a dit (il dicte souvent à la voix : corrige les évidences, comme « zéro six » = 06). S'il manque le prénom ou un moyen de contact, demande-le. Ne dis jamais que le contact est créé : il doit confirmer lui-même sur la fiche qui s'affiche.
Pour prendre un rendez-vous (« mets Karim demain à 14h »), appelle proposer_rdv : convertis « demain », « jeudi »… en date exacte à partir de la date du jour. Le rendez-vous est posé même si l'heure est hors des disponibilités (le créneau s'ouvre de fait) : ne dis jamais que c'est impossible pour cette raison. Dis seulement que la carte est prête à confirmer, jamais que c'est réservé. Si l'heure est déjà prise, propose-en une autre.
Tu peux AGIR dans Calio : règles de répartition des appels (qui prend quels appels selon le budget, la situation ou l'origine), priorités des closers, activer/désactiver un closer, réglages de réservation, horaires et jours off d'un closer, statut / déplacement / closer / résultat et montant signé d'un appel, note et suivi d'une fiche, étapes de la séquence de confirmation, blocage d'une personne. Méthode : (1) lis l'état avec configuration, appels ou chercher_prospects pour retrouver les identifiants (ne devine jamais un id) ; (2) appelle proposer_action ; (3) dis en une phrase ce que la carte va faire. Une carte par action : si la demande en contient plusieurs, appelle proposer_action plusieurs fois. Clément confirme chaque carte d'un tap : ne dis JAMAIS que c'est fait, dis que la carte est prête.
Budgets : lt500 = moins de 500 €, 500-1000 = 500 à 1 000 €, 1000-3000, gt3000 = plus de 3 000 €. Attention : les personnes à moins de 500 € ne réservent pas d'appel (elles sont envoyées vers la Méthode à 97 €). Si Clément demande « les appels à moins de 500 € », applique la règle telle quelle (lt500) et ajoute une phrase pour le prévenir, en proposant la tranche 500 à 1 000 € s'il pensait à celle-là.
Pour « Amandine prend les appels à moins de X € » : crée une règle (regle_ajouter) pour Amandine avec les budgets concernés sur le lien principal, sauf si un autre lien est nommé ; pour « ne donne plus d'appels à Amandine » : priorité off ou closer désactivé selon ce qui est demandé.
Tu ne peux pas : envoyer un message ou un email à un prospect, supprimer définitivement des données, valider à sa place les emails automatiques (il doit les lire dans Calio), toucher aux paiements, aux accès ou aux mots de passe. Si on te le demande, dis-le simplement.
N'affiche pas de numéro ni d'email sauf si on te les demande.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'méthode' }, 405)
  try {
    // 1. qui appelle ? (jeton de l'utilisateur) → admin seulement
    const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!tok) return json({ error: 'auth' }, 401)
    const me = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SKEY, Authorization: `Bearer ${tok}` } })
    if (!me.ok) return json({ error: 'auth' }, 401)
    const adm = await fetch(`${URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: SKEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}' })
    if (!adm.ok || (await adm.json()) !== true) return json({ error: 'forbidden' }, 403)

    // 2. clé Claude
    const key = await rpc('calio_ai_key')
    if (!key) return json({ error: 'no_key' })

    // 3. conversation
    const body = await req.json().catch(() => ({}))
    const msgs: { role: string; content: unknown }[] = (Array.isArray(body.messages) ? body.messages : []).slice(-14)
      .map((m: { role: string; text: string }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text ?? '').slice(0, 4000) }))
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'vide' }, 400)

    const proposals: Record<string, unknown>[] = []
    let reply = ''
    for (let i = 0; i < 6; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: SYSTEM(), tools: TOOLS, messages: msgs }),
      })
      if (!r.ok) {
        const t = await r.text(); console.error('anthropic', r.status, t)
        return json({ error: r.status === 401 ? 'bad_key' : 'ia', status: r.status })
      }
      const d = await r.json()
      msgs.push({ role: 'assistant', content: d.content })
      const uses = (d.content as { type: string; id: string; name: string; input: Record<string, unknown> }[]).filter((c) => c.type === 'tool_use')
      if (d.stop_reason !== 'tool_use' || !uses.length) {
        reply = (d.content as { type: string; text?: string }[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
        break
      }
      const results = []
      for (const u of uses) {
        let out: unknown
        try { out = await runTool(u.name, u.input ?? {}, proposals) } catch (e) { console.error('tool', u.name, (e as Error).message); out = { erreur: 'lecture impossible pour le moment' } }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) })
      }
      msgs.push({ role: 'user', content: results })
    }
    return json({ reply: reply || 'Je n’ai pas réussi à répondre, réessaie.', proposals })
  } catch (e) {
    console.error('assistant', (e as Error).message)
    return json({ error: 'serveur' }, 500)
  }
})
