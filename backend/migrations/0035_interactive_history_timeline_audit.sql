ALTER TABLE historical_replay_audit
  ADD COLUMN fork_core_timeline_id UUID;

ALTER TABLE historical_replay_audit
  DROP CONSTRAINT IF EXISTS historical_replay_audit_action_check,
  ADD CONSTRAINT historical_replay_audit_action_check CHECK(action IN
    ('created','cancelled','promoted','viewed','analysis_created',
     'timeline_created','timeline_forked'));

CREATE INDEX idx_historical_replay_audit_timeline
  ON historical_replay_audit(project_id,fork_core_timeline_id,created_at DESC);
