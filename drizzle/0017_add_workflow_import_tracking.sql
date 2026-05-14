-- Add import tracking columns to workflows table
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS imported_from TEXT;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS conversion_metadata JSONB;
