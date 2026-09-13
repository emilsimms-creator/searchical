-- Searchical Phase 3a: the Engagement Engine, drafting half.
--
-- Sequences, the eight templates, the personalisation gate, the approval queue
-- and the exploratory call. Output is an approved draft the recruiter relays by
-- hand: this phase deliberately stops short of sending, which is the Autonomous
-- Cut. See architecture.md s16.1 and s7.

CREATE TYPE outreach_channel AS ENUM (
  'linkedin_connection', 'linkedin_inmail', 'email', 'phone', 'voicemail', 'referral'
);

CREATE TYPE sequence_state AS ENUM ('active', 'completed', 'cancelled');

CREATE TYPE message_state AS ENUM (
  'drafted', 'blocked', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'relayed'
);

CREATE TYPE approval_decision AS ENUM ('approved', 'edited', 'rejected');

-- The eight rungs of the response ladder, from the Playbook section 3.6.
CREATE TYPE reply_rung AS ENUM (
  'explicit_not_interested', 'silence_after_sequence', 'polite_decline_but_engaged',
  'keep_me_in_mind', 'question_about_scope', 'question_about_compensation',
  'agreed_to_conversation', 'referred_a_colleague'
);

CREATE TABLE sequences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id    uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  state          sequence_state NOT NULL DEFAULT 'active',
  started_at     timestamptz NOT NULL,
  cancelled_at   timestamptz,
  cancelled_reason text,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One live sequence per prospect. A second concurrent sequence is how a person
-- receives ten touches while every individual sequence looks polite.
CREATE UNIQUE INDEX sequences_one_active_per_prospect
  ON sequences (prospect_id) WHERE state = 'active';

CREATE TABLE sequence_steps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id    uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  touch          integer NOT NULL CHECK (touch BETWEEN 1 AND 6),
  template_code  text NOT NULL,
  channel        outreach_channel NOT NULL,
  purpose        text NOT NULL,
  scheduled_for  date NOT NULL,
  optional       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Never double queue. One step per touch per sequence, enforced rather than
  -- hoped for.
  UNIQUE (sequence_id, touch)
);

CREATE TABLE messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_step_id uuid NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  template_code  text NOT NULL,
  channel        outreach_channel NOT NULL,
  subject        text,
  body           text NOT NULL,
  state          message_state NOT NULL DEFAULT 'drafted',
  -- Why a blocked message is blocked, in the recruiter's own terms.
  blocked_reason text,
  sends_as       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_step_id)
);

-- The personalisation gate, expressed as rows.
--
-- Every hook on a queued message points at an evidence row. A message with no
-- rows here cannot reach the approval queue, because the function that queues
-- it refuses. See architecture.md s7.2.
CREATE TABLE message_hooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  token        text NOT NULL,
  value        text NOT NULL,
  evidence_id  uuid NOT NULL REFERENCES evidence(id),
  citation     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, token)
);

CREATE TABLE approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  decision      approval_decision NOT NULL,
  -- Kept whole rather than as a diff so the corpus of accepted and edited copy
  -- can be read as the practice's house voice later.
  original_body text NOT NULL,
  final_body    text NOT NULL,
  reason        text,
  decided_by    text NOT NULL,
  queued_at     timestamptz NOT NULL,
  decided_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

CREATE INDEX approvals_metrics_idx ON approvals (tenant_id, decision, decided_at);

-- Replies recorded by hand in this phase. Sending and ingestion are the
-- Autonomous Cut; what matters here is that a recorded reply stops the sequence.
CREATE TABLE replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id   uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  rung          reply_rung NOT NULL,
  received_at   timestamptz NOT NULL,
  note          text,
  recorded_by   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The exploratory call: the six stage structure and what it captured.
CREATE TABLE calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id       uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  held_at           timestamptz NOT NULL,
  minutes           integer,
  interest_scale    interest_scale,
  push_factors      text,
  dominant_motivator text,
  timing_trigger    text,
  deal_breakers     text,
  -- The standard is two to three warm referrals from every exploratory call,
  -- and the reliable way to miss it is not to ask.
  referrals_given   integer NOT NULL DEFAULT 0,
  -- Compensation is not raised before the mid point of the call.
  compensation_discussed boolean NOT NULL DEFAULT false,
  disposition       disposition,
  notes             text,
  recorded_by       text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'sequences', 'sequence_steps', 'messages', 'message_hooks', 'approvals', 'replies', 'calls'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO searchical_app', t);
  END LOOP;
END
$$;

GRANT UPDATE ON sequences, messages, prospects TO searchical_app;

-- An approval, a reply and a call are observations of what happened. Rewriting
-- one destroys the only record of the decision, and the approval corpus is the
-- measure of whether the drafting is any good.
REVOKE UPDATE, DELETE ON approvals, replies, calls, message_hooks, sequence_steps FROM searchical_app;

-- ---------------------------------------------------------------------------
-- The queue function: the personalisation gate as a property of the database
--
-- `messages` may not be inserted directly. A message reaches the approval queue
-- only through this function, which refuses when the template demands evidence
-- and none was supplied. A generic message is therefore not representable, in
-- the same way a bare fact is not representable in the ledger.
-- ---------------------------------------------------------------------------

REVOKE INSERT ON messages FROM searchical_app;

CREATE FUNCTION engagement_queue_message(
  p_sequence_step_id uuid,
  p_template_code    text,
  p_channel          outreach_channel,
  p_subject          text,
  p_body             text,
  p_requires_hook    boolean,
  p_hook_count       integer,
  p_sends_as         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sequence_steps s WHERE s.id = p_sequence_step_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'sequence step % does not belong to tenant %', p_sequence_step_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_requires_hook AND COALESCE(p_hook_count, 0) < 1 THEN
    RAISE EXCEPTION
      'personalisation gate: template % requires a verified person specific hook and none was supplied. '
      'Somewhat personalised outreach performs no better than none, so this goes back to research.',
      p_template_code
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO messages (
    tenant_id, sequence_step_id, template_code, channel, subject, body, state, sends_as
  ) VALUES (
    v_tenant, p_sequence_step_id, p_template_code, p_channel, p_subject, p_body,
    'awaiting_approval', p_sends_as
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION engagement_queue_message(uuid, text, outreach_channel, text, text, boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION engagement_queue_message(uuid, text, outreach_channel, text, text, boolean, integer, text) TO searchical_app;
