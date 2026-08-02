-- Tags (doc 03 §4).

CREATE TABLE tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT,
  UNIQUE (project_id, name)
);

CREATE TABLE tag_attachments (
  tag_id          UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('wallet','contract')),
  entity_id       UUID NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
