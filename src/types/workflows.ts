export interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  trigger: {
    type: 'manual' | 'cron' | 'webhook' | 'telegram' | 'discord' | 'chat' | 'chat-input' | 'gmail' | 'outlook';
    config: Record<string, unknown>;
  };
  config: Record<string, unknown>;
  createdAt: Date | null;
  lastRun: Date | null;
  lastRunStatus: string | null;
  lastRunOutput: unknown | null;
  runCount: number;
  conversationCount?: number;
}

export interface CredentialListItem {
  id: string;
  platform: string;
  name: string;
  type: string;
  createdAt: Date | null;
  lastUsed: Date | null;
  isVerified?: boolean;        // OAuth account verified/connected
  isExpired?: boolean;          // OAuth token expired
  connectedAccount?: string;    // Connected account name/email
  metadata?: {
    selectedScopes?: string[];
    grantedScopes?: string[];
    serviceConfig?: string;
    connectedEmail?: string;
  };
}
