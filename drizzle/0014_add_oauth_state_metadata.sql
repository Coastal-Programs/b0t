-- Add metadata field to oauth_state table for storing OAuth flow metadata (scopes, service, mode, credentialId)
ALTER TABLE "oauth_state" ADD COLUMN "metadata" text;
