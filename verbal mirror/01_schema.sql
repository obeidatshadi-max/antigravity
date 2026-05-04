-- ═══════════════════════════════════════════════════════════════════
--  ANTIGRAVITY ECOSYSTEM — SUPABASE SCHEMA
--  Shared backend for ORBIT (habit intelligence) + Verbal Mirror
--  (acoustic intelligence). One user identity, two instruments.
-- ═══════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────────────────────────────────────────────
--  USERS & PROFILES
-- ───────────────────────────────────────────────

-- Extended profile (wraps Supabase auth.users)
CREATE TABLE public.profiles (
  id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name        TEXT,
  display_name     TEXT,
  email            TEXT,
  avatar_url       TEXT,
  preferred_lang   TEXT        NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('en', 'ar')),
  role             TEXT        NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'coach', 'admin')),
  coach_id         UUID        REFERENCES public.profiles(id),  -- assigned coach (if client)
  timezone         TEXT        DEFAULT 'Asia/Amman',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ───────────────────────────────────────────────
--  ORBIT — HABIT INTELLIGENCE TABLES
-- ───────────────────────────────────────────────

-- Antigravity persona profile (the stable architecture)
-- Gravity domains: Thinking, Emotional, Behavioral/Physical (0–10 each)
CREATE TABLE public.orbit_personas (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Gravity domain scores
  gravity_thinking  NUMERIC(4,2) CHECK (gravity_thinking BETWEEN 0 AND 10),
  gravity_emotional NUMERIC(4,2) CHECK (gravity_emotional BETWEEN 0 AND 10),
  gravity_physical  NUMERIC(4,2) CHECK (gravity_physical BETWEEN 0 AND 10),
  -- Derived fields
  gravity_total     NUMERIC(4,2) GENERATED ALWAYS AS (
    (gravity_thinking + gravity_emotional + gravity_physical) / 3.0
  ) STORED,
  heaviest_domain   TEXT        GENERATED ALWAYS AS (
    CASE
      WHEN gravity_thinking >= gravity_emotional AND gravity_thinking >= gravity_physical THEN 'thinking'
      WHEN gravity_emotional >= gravity_thinking AND gravity_emotional >= gravity_physical THEN 'emotional'
      ELSE 'physical'
    END
  ) STORED,
  -- Antigravity mass/distance metrics
  psychological_mass     NUMERIC(4,2),  -- 0–10: internal attachment weight
  trigger_distance       NUMERIC(4,2),  -- 0–10: distance from gravitational triggers
  -- Personality & pattern data
  archetype_label        TEXT,          -- e.g. "The Measured Architect"
  enneagram_hint         TEXT,          -- e.g. "Type 5 with 4 wing"
  dominant_mask          TEXT           CHECK (dominant_mask IN ('confidence','minimization','obligation')),
  mask_score             NUMERIC(4,2)   CHECK (mask_score BETWEEN 0 AND 100),
  -- 4Cs (organizational Antigravity)
  score_creativity       NUMERIC(4,2),
  score_collaboration    NUMERIC(4,2),
  score_critical_thinking NUMERIC(4,2),
  score_communication    NUMERIC(4,2),
  -- Source and validity
  source                 TEXT           DEFAULT 'orbit' CHECK (source IN ('orbit','verbal_mirror','coach','assessment')),
  is_baseline            BOOLEAN        DEFAULT FALSE,  -- marks the founding persona
  notes                  TEXT,
  created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TRIGGER orbit_personas_updated_at
  BEFORE UPDATE ON public.orbit_personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_orbit_personas_user ON public.orbit_personas(user_id);

-- Habit entries (daily habit log from ORBIT)
CREATE TABLE public.orbit_habit_entries (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  persona_id      UUID        REFERENCES public.orbit_personas(id),
  -- Antigravity habit loop
  habit_domain    TEXT        NOT NULL CHECK (habit_domain IN ('thinking','emotional','physical','personality')),
  trigger_desc    TEXT,
  action_taken    TEXT,
  reward_received TEXT,
  -- Antigravity force applied
  strategy_used   TEXT        CHECK (strategy_used IN ('mindfulness','interruption','journaling','trigger_management','antigravity_force')),
  mass_before     NUMERIC(4,2),
  mass_after      NUMERIC(4,2),
  distance_before NUMERIC(4,2),
  distance_after  NUMERIC(4,2),
  reflection_note TEXT,
  mood_score      SMALLINT    CHECK (mood_score BETWEEN 1 AND 10),
  energy_score    SMALLINT    CHECK (energy_score BETWEEN 1 AND 10),
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orbit_habits_user ON public.orbit_habit_entries(user_id);
CREATE INDEX idx_orbit_habits_date ON public.orbit_habit_entries(logged_at DESC);

-- 30-day action plans
CREATE TABLE public.orbit_action_plans (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  persona_id      UUID        REFERENCES public.orbit_personas(id),
  title           TEXT        NOT NULL,
  domain          TEXT        NOT NULL CHECK (domain IN ('thinking','emotional','physical','personality')),
  strategy        TEXT,
  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  target_mass     NUMERIC(4,2),
  target_distance NUMERIC(4,2),
  success_indicators JSONB    DEFAULT '[]',
  progress_pct    SMALLINT    DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  status          TEXT        DEFAULT 'active' CHECK (status IN ('active','completed','paused','abandoned')),
  coach_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER orbit_plans_updated_at
  BEFORE UPDATE ON public.orbit_action_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ───────────────────────────────────────────────
--  VERBAL MIRROR — ACOUSTIC INTELLIGENCE TABLES
-- ───────────────────────────────────────────────

-- Solo analysis sessions
CREATE TABLE public.vm_analyses (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  orbit_persona_id      UUID        REFERENCES public.orbit_personas(id),  -- pre-loaded context
  -- Input
  mode                  TEXT        NOT NULL DEFAULT 'solo' CHECK (mode IN ('solo','comparison','journal')),
  input_type            TEXT        NOT NULL CHECK (input_type IN ('voice','text')),
  transcript            TEXT,
  audio_duration_sec    NUMERIC(6,2),
  -- Acoustic measurements
  pitch_hz_avg          NUMERIC(6,2),
  pitch_hz_min          NUMERIC(6,2),
  pitch_hz_max          NUMERIC(6,2),
  pace_wpm              NUMERIC(6,2),
  hesitation_count      SMALLINT,
  hesitation_index      NUMERIC(4,2),  -- 0–10 normalized
  tonal_weight          NUMERIC(4,2),  -- 0–10
  -- Gravity Score (three domains, 0–10)
  gravity_thinking      NUMERIC(4,2),
  gravity_emotional     NUMERIC(4,2),
  gravity_physical      NUMERIC(4,2),
  gravity_total         NUMERIC(4,2),
  -- Mask Score™
  mask_score            NUMERIC(5,2),  -- 0–100
  mask_type             TEXT           CHECK (mask_type IN ('confidence','minimization','obligation')),
  mask_evidence         JSONB          DEFAULT '{}',  -- {axis, reading, evidence[]}
  -- AI-generated outputs
  archetype_label       TEXT,
  archetype_desc        TEXT,
  enneagram_hint        TEXT,
  voice_signature       TEXT,
  profile_summary       TEXT,
  -- Voice Letter (three movements)
  letter_mirror         TEXT,
  letter_gap            TEXT,
  letter_invitation     TEXT,
  -- Interventions
  interventions         JSONB          DEFAULT '[]',
  -- Delta from ORBIT baseline (filled if orbit_persona_id present)
  delta_thinking        NUMERIC(4,2),
  delta_emotional       NUMERIC(4,2),
  delta_physical        NUMERIC(4,2),
  delta_mask            NUMERIC(5,2),
  -- Language
  language              TEXT          DEFAULT 'en' CHECK (language IN ('en','ar')),
  -- Sharing
  share_token           TEXT          UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_public             BOOLEAN       DEFAULT FALSE,
  -- PDF export
  pdf_exported_at       TIMESTAMPTZ,
  -- Metadata
  raw_ai_response       JSONB,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vm_analyses_user      ON public.vm_analyses(user_id);
CREATE INDEX idx_vm_analyses_share     ON public.vm_analyses(share_token);
CREATE INDEX idx_vm_analyses_created   ON public.vm_analyses(created_at DESC);
CREATE INDEX idx_vm_analyses_persona   ON public.vm_analyses(orbit_persona_id);

-- Conversation Comparison sessions (two voices)
CREATE TABLE public.vm_comparisons (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Voice A (typically the user/client)
  voice_a_name          TEXT        DEFAULT 'Voice A',
  voice_a_analysis_id   UUID        REFERENCES public.vm_analyses(id),
  voice_a_transcript    TEXT,
  voice_a_pitch_avg     NUMERIC(6,2),
  voice_a_pace_wpm      NUMERIC(6,2),
  voice_a_gravity       NUMERIC(4,2),
  voice_a_mask          NUMERIC(5,2),
  -- Voice B
  voice_b_name          TEXT        DEFAULT 'Voice B',
  voice_b_analysis_id   UUID        REFERENCES public.vm_analyses(id),
  voice_b_transcript    TEXT,
  voice_b_pitch_avg     NUMERIC(6,2),
  voice_b_pace_wpm      NUMERIC(6,2),
  voice_b_gravity       NUMERIC(4,2),
  voice_b_mask          NUMERIC(5,2),
  -- Comparison outputs
  rapport_score         NUMERIC(4,2),  -- 0–10
  acoustic_gap          NUMERIC(4,2),  -- absolute pitch/pace divergence
  adaptor_label         TEXT,          -- who adapts to whom
  power_dynamic         TEXT,          -- dominant/submissive/balanced
  dissonance_hotspots   JSONB          DEFAULT '[]',
  orbital_map           JSONB          DEFAULT '{}',
  synthesis_text        TEXT,
  -- Submode: live vs reply analysis
  submode               TEXT           DEFAULT 'live' CHECK (submode IN ('live','reply')),
  language              TEXT           DEFAULT 'en' CHECK (language IN ('en','ar')),
  share_token           TEXT           UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_public             BOOLEAN        DEFAULT FALSE,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vm_comparisons_user ON public.vm_comparisons(user_id);

-- Voice Journal entries (daily 60-second check-ins)
CREATE TABLE public.vm_journal_entries (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  orbit_persona_id      UUID        REFERENCES public.orbit_personas(id),
  -- Acoustic snapshot
  pitch_hz_avg          NUMERIC(6,2),
  pace_wpm              NUMERIC(6,2),
  hesitation_index      NUMERIC(4,2),
  -- Gravity snapshot
  gravity_thinking      NUMERIC(4,2),
  gravity_emotional     NUMERIC(4,2),
  gravity_physical      NUMERIC(4,2),
  gravity_total         NUMERIC(4,2),
  mask_score            NUMERIC(5,2),
  -- AI insight
  daily_insight         TEXT,
  context_note          TEXT,         -- user's optional context note
  transcript            TEXT,
  -- Streak tracking (computed on insert via trigger)
  streak_day            SMALLINT     DEFAULT 1,
  entry_date            DATE         NOT NULL DEFAULT CURRENT_DATE,
  language              TEXT         DEFAULT 'en' CHECK (language IN ('en','ar')),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, entry_date)  -- one entry per user per day
);

CREATE INDEX idx_vm_journal_user ON public.vm_journal_entries(user_id);
CREATE INDEX idx_vm_journal_date ON public.vm_journal_entries(entry_date DESC);

-- Weekly portrait (generated after 7 journal entries)
CREATE TABLE public.vm_weekly_portraits (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start      DATE        NOT NULL,
  week_end        DATE        NOT NULL,
  portrait_text   TEXT        NOT NULL,
  -- Aggregated metrics for the week
  avg_gravity_thinking  NUMERIC(4,2),
  avg_gravity_emotional NUMERIC(4,2),
  avg_gravity_physical  NUMERIC(4,2),
  avg_mask_score        NUMERIC(5,2),
  avg_pitch_hz          NUMERIC(6,2),
  pitch_trend           TEXT    CHECK (pitch_trend IN ('descending','ascending','stable','volatile')),
  dominant_domain       TEXT,
  entry_count           SMALLINT DEFAULT 7,
  language              TEXT     DEFAULT 'en',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vm_portraits_user ON public.vm_weekly_portraits(user_id);

-- ───────────────────────────────────────────────
--  CROSS-APP BRIDGE TABLE
--  Links ORBIT habit events to Verbal Mirror
--  acoustic events on the same timeline
-- ───────────────────────────────────────────────

CREATE TABLE public.ecosystem_timeline (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN (
    'orbit_habit','orbit_plan_start','orbit_plan_complete',
    'vm_analysis','vm_journal','vm_comparison','vm_weekly_portrait'
  )),
  source_app      TEXT        NOT NULL CHECK (source_app IN ('orbit','verbal_mirror')),
  -- Polymorphic reference (only one will be set)
  orbit_habit_id  UUID        REFERENCES public.orbit_habit_entries(id),
  orbit_plan_id   UUID        REFERENCES public.orbit_action_plans(id),
  vm_analysis_id  UUID        REFERENCES public.vm_analyses(id),
  vm_journal_id   UUID        REFERENCES public.vm_journal_entries(id),
  vm_comparison_id UUID       REFERENCES public.vm_comparisons(id),
  vm_portrait_id  UUID        REFERENCES public.vm_weekly_portraits(id),
  -- Snapshot of key metrics at this moment (for timeline graphing)
  gravity_total   NUMERIC(4,2),
  mask_score      NUMERIC(5,2),
  pitch_hz        NUMERIC(6,2),
  notes           TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_user    ON public.ecosystem_timeline(user_id);
CREATE INDEX idx_timeline_date    ON public.ecosystem_timeline(occurred_at DESC);
CREATE INDEX idx_timeline_source  ON public.ecosystem_timeline(source_app);

-- ───────────────────────────────────────────────
--  COACH DASHBOARD VIEWS
-- ───────────────────────────────────────────────

-- Coach sees all their clients' latest persona + recent activity
CREATE VIEW public.coach_client_overview AS
SELECT
  p.id            AS client_id,
  p.full_name,
  p.email,
  p.preferred_lang,
  p.coach_id,
  -- Latest ORBIT persona
  op.gravity_thinking,
  op.gravity_emotional,
  op.gravity_physical,
  op.gravity_total,
  op.archetype_label,
  op.mask_score    AS orbit_mask_score,
  -- Latest journal entry
  (SELECT entry_date FROM public.vm_journal_entries
   WHERE user_id = p.id ORDER BY entry_date DESC LIMIT 1) AS last_journal_date,
  (SELECT streak_day FROM public.vm_journal_entries
   WHERE user_id = p.id ORDER BY entry_date DESC LIMIT 1) AS current_streak,
  -- Total analyses
  (SELECT COUNT(*) FROM public.vm_analyses WHERE user_id = p.id) AS total_analyses,
  (SELECT COUNT(*) FROM public.vm_journal_entries WHERE user_id = p.id) AS total_journal_entries
FROM public.profiles p
LEFT JOIN LATERAL (
  SELECT * FROM public.orbit_personas
  WHERE user_id = p.id
  ORDER BY created_at DESC LIMIT 1
) op ON TRUE
WHERE p.role = 'client';

-- Gravity drift view: ORBIT baseline vs latest Verbal Mirror journal
CREATE VIEW public.gravity_delta_view AS
SELECT
  p.id          AS user_id,
  p.full_name,
  -- ORBIT baseline
  op.gravity_thinking    AS baseline_thinking,
  op.gravity_emotional   AS baseline_emotional,
  op.gravity_physical    AS baseline_physical,
  -- Latest journal average (last 7 days)
  AVG(j.gravity_thinking)  AS recent_thinking,
  AVG(j.gravity_emotional) AS recent_emotional,
  AVG(j.gravity_physical)  AS recent_physical,
  -- Delta
  AVG(j.gravity_thinking)  - op.gravity_thinking  AS delta_thinking,
  AVG(j.gravity_emotional) - op.gravity_emotional AS delta_emotional,
  AVG(j.gravity_physical)  - op.gravity_physical  AS delta_physical
FROM public.profiles p
LEFT JOIN public.orbit_personas op ON op.user_id = p.id AND op.is_baseline = TRUE
LEFT JOIN public.vm_journal_entries j ON j.user_id = p.id
  AND j.entry_date >= CURRENT_DATE - INTERVAL '7 days'
WHERE p.role = 'client'
GROUP BY p.id, p.full_name, op.gravity_thinking, op.gravity_emotional, op.gravity_physical;

-- ───────────────────────────────────────────────
--  ROW LEVEL SECURITY (RLS)
-- ───────────────────────────────────────────────

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbit_personas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbit_habit_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbit_action_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_analyses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_comparisons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_journal_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_weekly_portraits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_timeline    ENABLE ROW LEVEL SECURITY;

-- Profiles: users see their own; coaches see their clients
CREATE POLICY "profiles_self" ON public.profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "profiles_coach_read" ON public.profiles
  FOR SELECT USING (coach_id = auth.uid());

-- ORBIT data: own data + coach read
CREATE POLICY "orbit_personas_own" ON public.orbit_personas
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "orbit_personas_coach" ON public.orbit_personas
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.profiles WHERE coach_id = auth.uid())
  );

CREATE POLICY "orbit_habits_own" ON public.orbit_habit_entries
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "orbit_habits_coach" ON public.orbit_habit_entries
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.profiles WHERE coach_id = auth.uid())
  );

CREATE POLICY "orbit_plans_own" ON public.orbit_action_plans
  FOR ALL USING (user_id = auth.uid());

-- VM data: own data + coach read + public share_token read
CREATE POLICY "vm_analyses_own" ON public.vm_analyses
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "vm_analyses_coach" ON public.vm_analyses
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.profiles WHERE coach_id = auth.uid())
  );

CREATE POLICY "vm_analyses_public" ON public.vm_analyses
  FOR SELECT USING (is_public = TRUE);

CREATE POLICY "vm_journal_own" ON public.vm_journal_entries
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "vm_journal_coach" ON public.vm_journal_entries
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.profiles WHERE coach_id = auth.uid())
  );

CREATE POLICY "vm_comparisons_own" ON public.vm_comparisons
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "vm_portraits_own" ON public.vm_weekly_portraits
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "ecosystem_timeline_own" ON public.ecosystem_timeline
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "ecosystem_timeline_coach" ON public.ecosystem_timeline
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.profiles WHERE coach_id = auth.uid())
  );

-- ───────────────────────────────────────────────
--  AUTO-INSERT TIMELINE EVENTS (triggers)
-- ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_vm_analysis_to_timeline()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ecosystem_timeline
    (user_id, event_type, source_app, vm_analysis_id, gravity_total, mask_score, occurred_at)
  VALUES
    (NEW.user_id, 'vm_analysis', 'verbal_mirror', NEW.id, NEW.gravity_total, NEW.mask_score, NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER vm_analysis_timeline
  AFTER INSERT ON public.vm_analyses
  FOR EACH ROW EXECUTE FUNCTION public.log_vm_analysis_to_timeline();

CREATE OR REPLACE FUNCTION public.log_vm_journal_to_timeline()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ecosystem_timeline
    (user_id, event_type, source_app, vm_journal_id, gravity_total, mask_score, pitch_hz, occurred_at)
  VALUES
    (NEW.user_id, 'vm_journal', 'verbal_mirror', NEW.id, NEW.gravity_total, NEW.mask_score, NEW.pitch_hz_avg, NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER vm_journal_timeline
  AFTER INSERT ON public.vm_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_vm_journal_to_timeline();

CREATE OR REPLACE FUNCTION public.log_orbit_habit_to_timeline()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ecosystem_timeline
    (user_id, event_type, source_app, orbit_habit_id, occurred_at)
  VALUES
    (NEW.user_id, 'orbit_habit', 'orbit', NEW.id, NEW.logged_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER orbit_habit_timeline
  AFTER INSERT ON public.orbit_habit_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_orbit_habit_to_timeline();
