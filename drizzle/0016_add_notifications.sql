-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(500) NOT NULL,
  message TEXT,
  link VARCHAR(500),
  read INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_type ON notifications(type);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  workflow_failures INTEGER NOT NULL DEFAULT 1,
  credential_expiry INTEGER NOT NULL DEFAULT 1,
  credential_refresh_failure INTEGER NOT NULL DEFAULT 1,
  system_alerts INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_notification_prefs_user_channel UNIQUE(user_id, channel)
);
