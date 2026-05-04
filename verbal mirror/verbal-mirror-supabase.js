// ═══════════════════════════════════════════════════════════════════
//  verbal-mirror-supabase.js
//  Drop this <script> block into verbal-mirror.html just before
//  the closing </body> tag.
//
//  What it does:
//  1. Reads ORBIT bridge params from URL on load
//  2. Authenticates the user (or prompts login)
//  3. Persists every analysis, journal entry, comparison, and
//     weekly portrait to Supabase automatically
//  4. Loads the user's journal history from Supabase on init
//     (replacing localStorage-only storage)
//  5. Pushes the ORBIT persona delta back to Supabase
// ═══════════════════════════════════════════════════════════════════

import {
  supabase,
  getSession,
  getUser,
  getLatestPersona,
  getBaselinePersona,
  saveVmAnalysis,
  saveJournalEntry,
  saveVmComparison,
  saveWeeklyPortrait,
  getJournalEntries,
  readOrbitBridgeParams,
} from './02_supabase_client.js'

// ── State ────────────────────────────────────────────────────────────
let SB_USER        = null
let SB_SESSION     = null
let ORBIT_CONTEXT  = null  // pre-loaded persona from ORBIT bridge
let BASELINE_PERSONA = null

// ── Boot ─────────────────────────────────────────────────────────────
async function vmSupabaseInit() {
  // 1. Check auth session
  SB_SESSION = await getSession()
  SB_USER    = SB_SESSION?.user || null

  // 2. Read ORBIT bridge if arriving from ORBIT iOS
  ORBIT_CONTEXT = readOrbitBridgeParams()

  if (ORBIT_CONTEXT && ORBIT_CONTEXT.userId) {
    // Show the ORBIT bridge banner (existing UI element in verbal-mirror.html)
    showOrbitBanner(ORBIT_CONTEXT)

    // If not signed in, attempt to match session to the ORBIT user
    if (!SB_USER) {
      console.info('[VM] ORBIT context present but no auth session. User should sign in.')
    }
  }

  // 3. Load baseline persona for delta calculations
  if (SB_USER) {
    BASELINE_PERSONA = await getBaselinePersona(SB_USER.id).catch(() => null)
  }

  // 4. Hydrate journal from Supabase (replaces localStorage-only approach)
  if (SB_USER) {
    await hydrateJournalFromSupabase()
  }

  // 5. Render auth status indicator
  renderAuthBadge()
}

// ── Show ORBIT bridge banner (wires into existing VM banner div) ─────
function showOrbitBanner(ctx) {
  const banner = document.getElementById('orbit-bridge-banner')
  if (!banner) return

  const label = document.getElementById('orbit-banner-label')
  const body  = document.getElementById('orbit-banner-body')
  const sub   = document.getElementById('orbit-banner-sub')

  if (label) label.textContent = 'From ORBIT'
  if (body)  body.textContent  = ctx.archetypeLabel
    ? `${ctx.archetypeLabel} — Gravity: T${ctx.gravityThinking} · E${ctx.gravityEmotional} · P${ctx.gravityPhysical}`
    : `Gravity loaded: T${ctx.gravityThinking} · E${ctx.gravityEmotional} · P${ctx.gravityPhysical}`
  if (sub)   sub.textContent   = 'Your ORBIT persona is active. Analysis will reference your baseline.'

  banner.style.display = 'block'
}

// ── Auth badge (injected into top-bar) ──────────────────────────────
function renderAuthBadge() {
  const topBar = document.querySelector('.top-bar')
  if (!topBar) return

  const existing = document.getElementById('sb-auth-badge')
  if (existing) existing.remove()

  const badge = document.createElement('div')
  badge.id = 'sb-auth-badge'
  badge.style.cssText = `
    display:flex; align-items:center; gap:6px;
    font-family:var(--mono); font-size:9px; letter-spacing:.15em;
    text-transform:uppercase; padding:4px 10px; border-radius:6px;
    border:1px solid rgba(255,255,255,.1); cursor:pointer;
    color:var(--muted2); transition:border-color .2s;
  `

  if (SB_USER) {
    badge.innerHTML = `<span style="color:var(--teal)">◉</span> ${SB_USER.email?.split('@')[0] || 'signed in'}`
    badge.title     = 'Signed in — data syncing to cloud'
  } else {
    badge.innerHTML = `<span style="color:var(--gold)">◎</span> sign in to sync`
    badge.title     = 'Sign in to save your data to the cloud'
    badge.onclick   = () => openAuthModal()
  }

  topBar.prepend(badge)
}

// ── Persist: Solo Analysis ───────────────────────────────────────────
//  Call this after the existing AI response handler populates results.
//  Hook into the existing function that renders the analysis card.
const _originalRenderAnalysis = window.renderAnalysisResult
window.renderAnalysisResult = async function(result, transcript, acoustics) {
  // Call the original render
  if (_originalRenderAnalysis) _originalRenderAnalysis(result, transcript, acoustics)

  if (!SB_USER) return  // local-only if not signed in

  try {
    const payload = buildAnalysisPayload(result, transcript, acoustics)
    const saved   = await saveVmAnalysis(SB_USER.id, payload)
    console.info('[VM→Supabase] Analysis saved:', saved.id)

    // Store the Supabase ID on the DOM for PDF export / sharing
    document.getElementById('results-card')?.setAttribute('data-sb-id', saved.id)
  } catch (err) {
    console.error('[VM→Supabase] Failed to save analysis:', err)
  }
}

function buildAnalysisPayload(result, transcript, acoustics) {
  return {
    orbit_persona_id:   ORBIT_CONTEXT?.personaId || null,
    mode:               currentMode() || 'solo',
    input_type:         acoustics ? 'voice' : 'text',
    transcript,
    audio_duration_sec: acoustics?.durationSec || null,
    pitch_hz_avg:       acoustics?.pitchAvg || null,
    pitch_hz_min:       acoustics?.pitchMin || null,
    pitch_hz_max:       acoustics?.pitchMax || null,
    pace_wpm:           acoustics?.paceWpm  || null,
    hesitation_count:   acoustics?.hesitationCount || null,
    hesitation_index:   acoustics?.hesitationIndex || null,
    tonal_weight:       result.tonal_weight || null,
    gravity_thinking:   result.gravity?.thinking ?? null,
    gravity_emotional:  result.gravity?.emotional ?? null,
    gravity_physical:   result.gravity?.physical  ?? null,
    gravity_total:      result.gravity?.total      ?? null,
    mask_score:         result.mask?.score         ?? null,
    mask_type:          result.mask?.dominant_type ?? null,
    mask_evidence:      result.mask?.axes          ?? {},
    archetype_label:    result.archetype?.label    ?? null,
    archetype_desc:     result.archetype?.desc     ?? null,
    enneagram_hint:     result.enneagram           ?? null,
    voice_signature:    result.voice_signature     ?? null,
    profile_summary:    result.profile_summary     ?? null,
    letter_mirror:      result.voice_letter?.mirror     ?? null,
    letter_gap:         result.voice_letter?.gap        ?? null,
    letter_invitation:  result.voice_letter?.invitation ?? null,
    interventions:      result.interventions        ?? [],
    // Delta from ORBIT baseline
    delta_thinking:   BASELINE_PERSONA
      ? (result.gravity?.thinking ?? 0) - (BASELINE_PERSONA.gravity_thinking ?? 0) : null,
    delta_emotional:  BASELINE_PERSONA
      ? (result.gravity?.emotional ?? 0) - (BASELINE_PERSONA.gravity_emotional ?? 0) : null,
    delta_physical:   BASELINE_PERSONA
      ? (result.gravity?.physical ?? 0) - (BASELINE_PERSONA.gravity_physical ?? 0) : null,
    delta_mask:       BASELINE_PERSONA
      ? (result.mask?.score ?? 0) - (BASELINE_PERSONA.mask_score ?? 0) : null,
    language:         document.body.classList.contains('ar') ? 'ar' : 'en',
    raw_ai_response:  result,
  }
}

// ── Persist: Journal Entry ───────────────────────────────────────────
//  Hook into the existing saveJournalEntry function.
const _originalSaveJournal = window.saveJournalEntry
window.saveJournalEntry = async function() {
  if (_originalSaveJournal) await _originalSaveJournal()

  if (!SB_USER) return

  // Pull the entry data from the DOM / existing journal state
  const entry = getLatestLocalJournalEntry()
  if (!entry) return

  try {
    await saveJournalEntry(SB_USER.id, {
      orbit_persona_id:  ORBIT_CONTEXT?.personaId || null,
      pitch_hz_avg:      entry.pitchAvg    || null,
      pace_wpm:          entry.paceWpm     || null,
      hesitation_index:  entry.hesitation  || null,
      gravity_thinking:  entry.gravity?.thinking  ?? null,
      gravity_emotional: entry.gravity?.emotional ?? null,
      gravity_physical:  entry.gravity?.physical  ?? null,
      gravity_total:     entry.gravity?.total      ?? null,
      mask_score:        entry.mask_score  || null,
      daily_insight:     entry.insight     || null,
      context_note:      document.getElementById('j-note-input')?.value || null,
      transcript:        entry.transcript  || null,
      language:          document.body.classList.contains('ar') ? 'ar' : 'en',
    })
    console.info('[VM→Supabase] Journal entry saved')
  } catch (err) {
    console.error('[VM→Supabase] Failed to save journal entry:', err)
  }
}

// ── Persist: Comparison ──────────────────────────────────────────────
const _originalSaveComparison = window.saveComparisonResult
window.saveComparisonResult = async function(compResult) {
  if (_originalSaveComparison) _originalSaveComparison(compResult)

  if (!SB_USER || !compResult) return

  try {
    await saveVmComparison(SB_USER.id, {
      voice_a_name:      compResult.voiceA?.name        || 'Voice A',
      voice_a_transcript: compResult.voiceA?.transcript || null,
      voice_a_pitch_avg: compResult.voiceA?.pitchAvg    || null,
      voice_a_pace_wpm:  compResult.voiceA?.paceWpm     || null,
      voice_a_gravity:   compResult.voiceA?.gravity     || null,
      voice_a_mask:      compResult.voiceA?.maskScore   || null,
      voice_b_name:      compResult.voiceB?.name        || 'Voice B',
      voice_b_transcript: compResult.voiceB?.transcript || null,
      voice_b_pitch_avg: compResult.voiceB?.pitchAvg   || null,
      voice_b_pace_wpm:  compResult.voiceB?.paceWpm    || null,
      voice_b_gravity:   compResult.voiceB?.gravity    || null,
      voice_b_mask:      compResult.voiceB?.maskScore  || null,
      rapport_score:     compResult.rapportScore       || null,
      acoustic_gap:      compResult.acousticGap        || null,
      adaptor_label:     compResult.adaptorLabel       || null,
      power_dynamic:     compResult.powerDynamic       || null,
      dissonance_hotspots: compResult.hotspots         || [],
      orbital_map:       compResult.orbitalMap         || {},
      synthesis_text:    compResult.synthesis          || null,
      submode:           compResult.submode            || 'live',
      language:          document.body.classList.contains('ar') ? 'ar' : 'en',
    })
    console.info('[VM→Supabase] Comparison saved')
  } catch (err) {
    console.error('[VM→Supabase] Failed to save comparison:', err)
  }
}

// ── Persist: Weekly Portrait ─────────────────────────────────────────
const _originalGenerateWeeklyPortrait = window.generateWeeklyPortrait
window.generateWeeklyPortrait = async function() {
  if (_originalGenerateWeeklyPortrait) await _originalGenerateWeeklyPortrait()

  if (!SB_USER) return

  // Read the rendered portrait text + aggregate metrics
  const portraitText = document.getElementById('journal-weekly-text')?.textContent
  if (!portraitText) return

  const entries = getLocalJournalEntries()
  const last7   = entries.slice(0, 7)
  if (last7.length < 7) return

  const avg = (key) => last7.reduce((s, e) => s + (e[key] || 0), 0) / last7.length

  try {
    const weekEnd   = new Date().toISOString().split('T')[0]
    const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]

    await saveWeeklyPortrait(SB_USER.id, {
      week_start:           weekStart,
      week_end:             weekEnd,
      portrait_text:        portraitText,
      avg_gravity_thinking: avg('gravity_thinking'),
      avg_gravity_emotional:avg('gravity_emotional'),
      avg_gravity_physical: avg('gravity_physical'),
      avg_mask_score:       avg('mask_score'),
      avg_pitch_hz:         avg('pitchAvg'),
      entry_count:          last7.length,
      language:             document.body.classList.contains('ar') ? 'ar' : 'en',
    })
    console.info('[VM→Supabase] Weekly portrait saved')
  } catch (err) {
    console.error('[VM→Supabase] Failed to save weekly portrait:', err)
  }
}

// ── Hydrate journal from Supabase on init ────────────────────────────
async function hydrateJournalFromSupabase() {
  try {
    const entries = await getJournalEntries(SB_USER.id, { limit: 60 })
    if (!entries || entries.length === 0) return

    // Merge into the existing localStorage journal (Supabase is source of truth)
    const localKey = 'vm_journal_v2'
    const mapped   = entries.map(e => ({
      date:             e.entry_date,
      pitchAvg:         e.pitch_hz_avg,
      paceWpm:          e.pace_wpm,
      hesitation:       e.hesitation_index,
      gravity_thinking: e.gravity_thinking,
      gravity_emotional:e.gravity_emotional,
      gravity_physical: e.gravity_physical,
      gravity_total:    e.gravity_total,
      mask_score:       e.mask_score,
      insight:          e.daily_insight,
      transcript:       e.transcript,
      context_note:     e.context_note,
      streak_day:       e.streak_day,
    }))

    localStorage.setItem(localKey, JSON.stringify(mapped))
    console.info(`[VM→Supabase] Hydrated ${mapped.length} journal entries from cloud`)

    // Trigger a re-render of the journal UI if the function exists
    if (typeof window.renderJournalUI === 'function') {
      window.renderJournalUI()
    }
  } catch (err) {
    console.warn('[VM→Supabase] Journal hydration failed (offline?):', err)
  }
}

// ── Simple auth modal ────────────────────────────────────────────────
function openAuthModal() {
  // Minimal sign-in modal injected into page
  const overlay = document.createElement('div')
  overlay.id    = 'sb-auth-modal'
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.7);
    display:flex; align-items:center; justify-content:center; z-index:9999;
  `
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border2);
      border-radius:16px;padding:28px 24px;width:320px;max-width:90vw;">
      <div style="font-family:var(--mono);font-size:9px;letter-spacing:.22em;
        text-transform:uppercase;color:var(--gold);opacity:.8;margin-bottom:18px;">
        Sign in to sync your data
      </div>
      <input id="sb-email" type="email" placeholder="Email"
        style="width:100%;margin-bottom:10px;padding:10px 12px;
        background:var(--surface2);border:1px solid var(--border);
        border-radius:8px;color:var(--text);font-size:14px;"/>
      <input id="sb-password" type="password" placeholder="Password"
        style="width:100%;margin-bottom:18px;padding:10px 12px;
        background:var(--surface2);border:1px solid var(--border);
        border-radius:8px;color:var(--text);font-size:14px;"/>
      <button onclick="sbSignIn()"
        style="width:100%;padding:11px;background:var(--gold);color:#13141e;
        border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">
        Sign In
      </button>
      <div style="margin-top:10px;text-align:center;font-size:13px;color:var(--muted2);">
        No account?
        <span onclick="sbSignUp()" style="color:var(--gold);cursor:pointer;">Create one</span>
      </div>
      <div id="sb-auth-error" style="margin-top:10px;font-size:12px;color:var(--red);display:none;"></div>
      <button onclick="document.getElementById('sb-auth-modal').remove()"
        style="position:absolute;top:10px;right:14px;background:none;border:none;
        color:var(--muted);cursor:pointer;font-size:15px;">✕</button>
    </div>
  `
  document.body.appendChild(overlay)
}

window.sbSignIn = async function() {
  const email    = document.getElementById('sb-email')?.value
  const password = document.getElementById('sb-password')?.value
  const errDiv   = document.getElementById('sb-auth-error')
  try {
    const { data } = await supabase.auth.signInWithPassword({ email, password })
    SB_USER    = data.user
    SB_SESSION = data.session
    document.getElementById('sb-auth-modal')?.remove()
    renderAuthBadge()
    await hydrateJournalFromSupabase()
  } catch (err) {
    if (errDiv) { errDiv.textContent = err.message; errDiv.style.display = 'block' }
  }
}

window.sbSignUp = async function() {
  const email    = document.getElementById('sb-email')?.value
  const password = document.getElementById('sb-password')?.value
  const errDiv   = document.getElementById('sb-auth-error')
  try {
    await supabase.auth.signUp({ email, password })
    if (errDiv) {
      errDiv.style.color   = 'var(--teal)'
      errDiv.textContent   = 'Check your email to confirm your account.'
      errDiv.style.display = 'block'
    }
  } catch (err) {
    if (errDiv) { errDiv.textContent = err.message; errDiv.style.display = 'block' }
  }
}

// ── Local helpers (read from existing VM localStorage) ───────────────
function getLocalJournalEntries() {
  try {
    return JSON.parse(localStorage.getItem('vm_journal_v2') || '[]')
  } catch { return [] }
}

function getLatestLocalJournalEntry() {
  const entries = getLocalJournalEntries()
  return entries[0] || null
}

function currentMode() {
  if (document.getElementById('mode-solo')?.classList.contains('active'))    return 'solo'
  if (document.getElementById('mode-compare')?.classList.contains('active')) return 'comparison'
  if (document.getElementById('mode-journal')?.classList.contains('active')) return 'journal'
  return 'solo'
}

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', vmSupabaseInit)
