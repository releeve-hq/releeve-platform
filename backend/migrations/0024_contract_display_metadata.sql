ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS appearance_color TEXT;
