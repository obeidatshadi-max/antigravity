// ═══════════════════════════════════════════════════════════════════
//  supabase.js — Shared Supabase client
//  Import this into both ORBIT and Verbal Mirror.
//  Works in browser (ESM) and Node / React Native.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Environment ────────────────────────────────────────────────────
//  Set these in your .env file or hosting platform:
//  SUPABASE_URL=https://your-project.supabase.co
//  SUPABASE_ANON_KEY=your-anon-key
//
//  For single-file HTML apps (ORBIT / Verbal Mirror), inject at build
//  time or prompt the user to enter them in settings.
// ──────────────────────────────────────────────────────────────────

const SUPABASE_URL     = window.__SUPABASE_URL__     || localStorage.getItem('sb_url')     || ''
const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || localStorage.getItem('sb_anon_key') || ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Antigravity] Supabase credentials not set. Call initSupabase() first.')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
})

// ── Runtime initialisation (for single-file HTML apps) ─────────────
export function initSupabase(url, anonKey) {
  localStorage.setItem('sb_url', url)
  localStorage.setItem('sb_anon_key', anonKey)
  location.reload()  // reload to apply credentials
}

// ── Auth helpers ────────────────────────────────────────────────────

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}

// ── Profile helpers ─────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── ORBIT — Persona helpers ─────────────────────────────────────────

export async function saveOrbitPersona(userId, personaData) {
  const { data, error } = await supabase
    .from('orbit_personas')
    .insert({ user_id: userId, ...personaData })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getLatestPersona(userId) {
  const { data, error } = await supabase
    .from('orbit_personas')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error  // PGRST116 = no rows
  return data || null
}

export async function getBaselinePersona(userId) {
  const { data, error } = await supabase
    .from('orbit_personas')
    .select('*')
    .eq('user_id', userId)
    .eq('is_baseline', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data || null
}

export async function setBaselinePersona(personaId, userId) {
  // Clear existing baseline first
  await supabase
    .from('orbit_personas')
    .update({ is_baseline: false })
    .eq('user_id', userId)

  const { data, error } = await supabase
    .from('orbit_personas')
    .update({ is_baseline: true })
    .eq('id', personaId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── ORBIT — Habit log helpers ───────────────────────────────────────

export async function logHabitEntry(userId, entryData) {
  const { data, error } = await supabase
    .from('orbit_habit_entries')
    .insert({ user_id: userId, ...entryData })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getHabitEntries(userId, { days = 30, domain = null } = {}) {
  let query = supabase
    .from('orbit_habit_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', new Date(Date.now() - days * 86400000).toISOString())
    .order('logged_at', { ascending: false })

  if (domain) query = query.eq('habit_domain', domain)

  const { data, error } = await query
  if (error) throw error
  return data
}

// ── Verbal Mirror — Analysis helpers ────────────────────────────────

export async function saveVmAnalysis(userId, analysisData) {
  const { data, error } = await supabase
    .from('vm_analyses')
    .insert({ user_id: userId, ...analysisData })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getVmAnalyses(userId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('vm_analyses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getVmAnalysisByShareToken(token) {
  const { data, error } = await supabase
    .from('vm_analyses')
    .select('*')
    .eq('share_token', token)
    .eq('is_public', true)
    .single()
  if (error) throw error
  return data
}

export async function makeVmAnalysisPublic(analysisId, userId) {
  const { data, error } = await supabase
    .from('vm_analyses')
    .update({ is_public: true })
    .eq('id', analysisId)
    .eq('user_id', userId)
    .select('share_token')
    .single()
  if (error) throw error
  return data.share_token
}

// ── Verbal Mirror — Journal helpers ─────────────────────────────────

export async function saveJournalEntry(userId, entryData) {
  const { data, error } = await supabase
    .from('vm_journal_entries')
    .upsert(
      { user_id: userId, entry_date: new Date().toISOString().split('T')[0], ...entryData },
      { onConflict: 'user_id,entry_date' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getJournalEntries(userId, { limit = 30 } = {}) {
  const { data, error } = await supabase
    .from('vm_journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getJournalStreak(userId) {
  const { data, error } = await supabase
    .from('vm_journal_entries')
    .select('entry_date, streak_day')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data ? data.streak_day : 0
}

// ── Verbal Mirror — Comparison helpers ──────────────────────────────

export async function saveVmComparison(userId, comparisonData) {
  const { data, error } = await supabase
    .from('vm_comparisons')
    .insert({ user_id: userId, ...comparisonData })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Verbal Mirror — Weekly portrait ─────────────────────────────────

export async function saveWeeklyPortrait(userId, portraitData) {
  const { data, error } = await supabase
    .from('vm_weekly_portraits')
    .insert({ user_id: userId, ...portraitData })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getWeeklyPortraits(userId, { limit = 8 } = {}) {
  const { data, error } = await supabase
    .from('vm_weekly_portraits')
    .select('*')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ── Cross-app: Ecosystem timeline ────────────────────────────────────

export async function getEcosystemTimeline(userId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('ecosystem_timeline')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ── Cross-app: ORBIT bridge → Verbal Mirror ──────────────────────────
//  Builds the URL parameter string that Verbal Mirror reads on load.
//  ORBIT calls this before redirecting the user to Verbal Mirror.

export async function buildOrbitBridgeUrl(userId, verbalMirrorBaseUrl) {
  const persona = await getLatestPersona(userId)
  if (!persona) return verbalMirrorBaseUrl

  const params = new URLSearchParams({
    orbit_uid:          userId,
    orbit_persona_id:   persona.id,
    orbit_gravity_t:    persona.gravity_thinking?.toFixed(2)  || '',
    orbit_gravity_e:    persona.gravity_emotional?.toFixed(2) || '',
    orbit_gravity_p:    persona.gravity_physical?.toFixed(2)  || '',
    orbit_archetype:    persona.archetype_label || '',
    orbit_mask:         persona.mask_score?.toFixed(0)        || '',
    orbit_mask_type:    persona.dominant_mask || '',
    orbit_enneagram:    persona.enneagram_hint || '',
    orbit_4c_comm:      persona.score_communication?.toFixed(2) || '',
  })

  return `${verbalMirrorBaseUrl}?${params.toString()}`
}

//  Verbal Mirror calls this on load to read the ORBIT bridge params.
export function readOrbitBridgeParams() {
  const params = new URLSearchParams(window.location.search)
  const orbitUid = params.get('orbit_uid')
  if (!orbitUid) return null

  return {
    userId:         orbitUid,
    personaId:      params.get('orbit_persona_id'),
    gravityThinking: parseFloat(params.get('orbit_gravity_t') || '0'),
    gravityEmotional: parseFloat(params.get('orbit_gravity_e') || '0'),
    gravityPhysical:  parseFloat(params.get('orbit_gravity_p') || '0'),
    archetypeLabel:  params.get('orbit_archetype') || '',
    maskScore:       parseFloat(params.get('orbit_mask') || '0'),
    maskType:        params.get('orbit_mask_type') || '',
    enneagramHint:   params.get('orbit_enneagram') || '',
    commScore:       parseFloat(params.get('orbit_4c_comm') || '0'),
  }
}

// ── Realtime subscriptions ───────────────────────────────────────────
//  Useful for the coach dashboard: get notified when a client
//  completes a journal entry or analysis in real time.

export function subscribeToClientJournal(coachUserId, callback) {
  return supabase
    .channel('client-journals')
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'vm_journal_entries',
      },
      payload => callback(payload.new)
    )
    .subscribe()
}

export function subscribeToClientAnalyses(callback) {
  return supabase
    .channel('client-analyses')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vm_analyses' },
      payload => callback(payload.new)
    )
    .subscribe()
}
