ALTER TABLE transactions
ADD COLUMN operation_details JSONB NOT NULL DEFAULT '[]'::jsonb;

