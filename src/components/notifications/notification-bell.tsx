'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  AlertTriangle,
  KeyRound,
  ServerCrash,
  CheckCheck,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  read: number;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

function getTypeConfig(type: string) {
  switch (type) {
    case 'workflow_failure':
      return {
        icon: <AlertTriangle className="h-4 w-4 shrink-0" />,
        label: 'Workflow Error',
        description: 'Encountered an error during execution',
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
      };
    case 'credential_expiry':
      return {
        icon: <KeyRound className="h-4 w-4 shrink-0" />,
        label: 'Credential Expiring',
        description: 'Expiring soon — renew to avoid disruptions',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
      };
    case 'credential_refresh_failure':
      return {
        icon: <KeyRound className="h-4 w-4 shrink-0" />,
        label: 'Credential Issue',
        description: 'Auto-refresh failed — reconnect to fix',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
      };
    case 'system_alert':
      return {
        icon: <ServerCrash className="h-4 w-4 shrink-0" />,
        label: 'System Alert',
        description: 'A system issue needs attention',
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
      };
    default:
      return {
        icon: <Bell className="h-4 w-4 shrink-0" />,
        label: 'Notification',
        description: '',
        color: 'text-muted-foreground',
        bg: 'bg-muted/50',
        border: 'border-border/50',
      };
  }
}

/** Extract a clean subject from the notification title (e.g. "Credential refresh failed: Cal.com" → "Cal.com") */
function getSubject(title: string): string | null {
  const colonIdx = title.indexOf(':');
  if (colonIdx !== -1) {
    const after = title.slice(colonIdx + 1).trim();
    if (after) return after;
  }
  return null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface NotificationBellProps {
  onOpenPreferences: () => void;
}

export function NotificationBell({ onOpenPreferences }: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(() => {
    fetch('/api/notifications?limit=10')
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((json: NotificationsResponse | null) => {
        if (json) setData(json);
      })
      .catch((err) => console.error('Failed to fetch notifications', err));
  }, []);

  // Fetch on mount + poll every 30 seconds
  useEffect(() => {
    queueMicrotask(fetchNotifications);
    intervalRef.current = setInterval(fetchNotifications, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  // Refresh when popover opens
  useEffect(() => {
    if (open) queueMicrotask(fetchNotifications);
  }, [open, fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: 'all' }),
      });
      fetchNotifications();
    } catch {
      // Silently fail
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (notification.read === 0) {
      try {
        await fetch('/api/notifications/read', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: notification.id }),
        });
        fetchNotifications();
      } catch {
        // Silently fail
      }
    }
    if (notification.link) {
      setOpen(false);
      router.push(notification.link);
    }
  };

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 relative overflow-visible">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white pointer-events-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 border-border bg-popover">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/15 px-1.5 text-[10px] font-medium text-red-400">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Read all
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOpen(false);
                onOpenPreferences();
              }}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Notification list */}
        <div className="max-h-[400px] overflow-y-auto">
          {!data || data.notifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="py-1">
              {data.notifications.map((n) => {
                const config = getTypeConfig(n.type);
                const subject = getSubject(n.title);

                return (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`group w-full flex items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                      n.read === 0
                        ? 'bg-gray-alpha-100 hover:bg-gray-alpha-200'
                        : 'hover:bg-gray-alpha-100'
                    }`}
                  >
                    {/* Icon with colored background */}
                    <div
                      className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md ${config.bg} ${config.color} border ${config.border}`}
                    >
                      {config.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Type label + timestamp row */}
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span
                          className={`text-[11px] font-medium uppercase tracking-wider ${config.color}`}
                        >
                          {config.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>

                      {/* Subject (extracted from title) */}
                      {subject && (
                        <p
                          className={`text-sm leading-snug truncate ${
                            n.read === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {subject}
                        </p>
                      )}

                      {/* Description */}
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {config.description}
                      </p>
                    </div>

                    {/* Unread dot or hover arrow */}
                    <div className="mt-2 shrink-0 w-4 flex items-center justify-center">
                      {n.read === 0 ? (
                        <span className="h-2 w-2 rounded-full bg-blue-500 group-hover:hidden" />
                      ) : null}
                      {n.link && (
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity ${
                            n.read === 0 ? 'hidden group-hover:block' : ''
                          }`}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
