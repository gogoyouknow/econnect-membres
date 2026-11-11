// Assistant IA de Calio : répond aux questions sur les appels / prospects (lecture seule) et PROPOSE des contacts à créer.
// Rien n'est écrit ici : la création se fait dans l'app, après le « Créer » de l'admin.
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
]

async function runTool(name: string, a: Record<string, unknown>, proposals: Record<string, unknown>[]): Promise<unknown> {
  if (name === 'chercher_prospects') {
    const lim = Math.min(Math.max(Number(a.limite) || 8, 1), 15)
    let q = `prospects_v?select=first_name,last_name,stage,situation,experience,blocage,capital,budget_confirmed,step,follow,source,created_at,call_at,call_status,phone,email&order=created_at.desc&limit=${lim}`
    if (a.stage) q += `&stage=eq.${clean(a.stage)}`
    if (a.jours) q += `&created_at=gte.${new Date(Date.now() - Number(a.jours) * 864e5).toISOString()}`
    const t = clean(a.texte)
    if (t) q += `&or=(first_name.ilike.*${t}*,last_name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t.replace(/\s/g, '')}*)`
    const rows = await sel(q)
    const keepContact = rows.length <= 5
    return rows.map((r: Record<string, string>) => ({
      nom: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans prénom', statut: r.stage, situation: r.situation, experience: r.experience,
      bloque_sur: r.blocage ? String(r.blocage).slice(0, 300) : null, budget: CAPL[r.capital] ?? null, budget_confirme: r.budget_confirmed, derniere_etape: r.step,
      relance: r.follow === 'done' ? 'déjà relancé' : r.follow === 'skip' ? 'écarté' : 'à relancer', source: r.source, cree_le: hm(r.created_at),
      appel: r.call_at ? `${hm(r.call_at)} (${r.call_status})` : null, ...(keepContact ? { whatsapp: r.phone, email: r.email } : {}),
    }))
  }
  if (name === 'appels') {
    const du = clean(a.du), au = clean(a.au)
    const rows = await sel(`candidatures?select=first_name,starts_at,status,situation,capital,closer&starts_at=gte.${du}T00:00:00%2B01:00&starts_at=lt.${au}T23:59:59%2B01:00&order=starts_at.asc&limit=60`)
    return rows.map((r: Record<string, string>) => ({ prenom: r.first_name, quand: hm(r.starts_at), statut: r.status, situation: r.situation, budget: CAPL[r.capital] ?? null, closer: r.closer }))
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
  return { erreur: 'outil inconnu' }
}

const SYSTEM = () => `Tu es l'assistant de Clément dans Calio, son app de prise de rendez-vous et de suivi des prospects (accompagnement e-commerce).
Nous sommes le ${parisNow()} (heure de Paris).
Tu réponds en français, court et direct, comme un collègue : une ou deux phrases, puis les chiffres ou la liste utile. Tutoie Clément.
Tu ne réponds QUE à partir des outils : ne devine jamais un chiffre ni un prospect. Si l'outil ne renvoie rien, dis-le simplement.
Définitions : « qualifié » = a indiqué 500 € ou plus ; « disqualifié » = moins de 500 € ou budget pas disponible maintenant ; « à relancer » = qualifié, pas encore relancé.
Pour créer un contact, appelle proposer_contact avec ce que Clément a dit (il dicte souvent à la voix : corrige les évidences, comme « zéro six » = 06). S'il manque le prénom ou un moyen de contact, demande-le. Ne dis jamais que le contact est créé : il doit confirmer lui-même sur la fiche qui s'affiche.
Tu ne peux ni envoyer de message, ni supprimer, ni modifier une fiche existante, ni créer de rappel. Si on te le demande, dis que tu ne peux pas encore.
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
        body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM(), tools: TOOLS, messages: msgs }),
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
