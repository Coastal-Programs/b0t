'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useClient } from '@/components/providers/ClientProvider';
import { useWeather } from '@/hooks/useWeather';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LogIn,
  LogOut,
  Loader2,
  ChevronDown,
  Building2,
  KeyRound,
  Brain,
  BookOpen,
  Bell,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { SystemStatusBadge } from '@/components/SystemStatusBadge';
import { PlatformSettingsDialog } from '@/components/settings/platform-settings-dialog';
import { MemorySettingsDialog } from '@/components/settings/memory-settings-dialog';
import { MindMapDialog } from '@/components/memory/mind-map-dialog';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { NotificationPreferencesDialog } from '@/components/notifications/notification-preferences-dialog';

// useSyncExternalStore helpers for a hydration-safe "have we mounted yet?" flag.
// The store never changes after subscription — getSnapshot returns true on the
// client, and getServerSnapshot returns false, so React renders `false` for
// SSR + first paint and `true` after hydration.
const subscribeNoop = (): (() => void) => () => {};
const getMountedSnapshot = (): boolean => true;
const getServerMountedSnapshot = (): boolean => false;

export function Header() {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memorySettingsOpen, setMemorySettingsOpen] = useState(false);
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  // Hydration-safe mount flag: returns false on the server and during the
  // initial client render, then true after hydration. Avoids the
  // useEffect(setState, []) pattern flagged by react-hooks/set-state-in-effect.
  const mounted = useSyncExternalStore(subscribeNoop, getMountedSnapshot, getServerMountedSnapshot);
  const { data: session, status } = useSession();
  const {
    currentClient,
    clients,
    setCurrentClient,
    isLoading: clientsLoading,
    isPlatformAdmin,
  } = useClient();
  const { display: weatherDisplay } = useWeather();
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Initialize timezone once - use queueMicrotask to avoid cascading renders
  useEffect(() => {
    queueMicrotask(() => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(tz);
    });
  }, []);

  // Update time in separate effect to avoid cascading renders
  useEffect(() => {
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    const updateTime = () => {
      const now = new Date();
      const timeString = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: tz,
      }).format(now);
      setCurrentTime(timeString);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [timezone]);

  const getInitials = (email?: string | null) => {
    if (!email) return '?';
    return email.charAt(0).toUpperCase();
  };

  return (
    <header className="flex h-14 min-h-14 items-center px-4 md:px-6 bg-background-100 border-b border-gray-alpha-400">
      <nav className="flex w-full items-center justify-between">
        {/* Left side - Logo/Brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <span className="text-xl font-bold bg-gradient-to-br from-blue-500 via-primary to-blue-500 bg-clip-text text-transparent">
              O
            </span>
            <span className="text-xl font-bold bg-gradient-to-br from-primary via-blue-500 to-primary bg-clip-text text-transparent">
              d
            </span>
            <span className="text-xl font-bold bg-gradient-to-br from-primary via-blue-500 to-primary bg-clip-text text-transparent">
              i
            </span>
            <span className="text-xl font-bold bg-gradient-to-br from-primary via-blue-500 to-primary bg-clip-text text-transparent">
              n
            </span>
          </div>

          {/* System Status Badge - Only show for platform admins */}
          {isPlatformAdmin && session?.user && <SystemStatusBadge />}

          {/* Timezone Clock & Weather */}
          {currentTime && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-700 ml-3 pl-3 border-l border-gray-alpha-400">
              <span className="font-mono tabular-nums">{currentTime}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-600">{timezone}</span>
              {weatherDisplay && (
                <>
                  <span className="text-gray-400 mx-0.5">|</span>
                  <span className="text-gray-600">{weatherDisplay}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right side - Client Switcher & User Avatar */}
        <div className="flex items-center gap-3">
          {/* Client Switcher */}
          {session?.user && clients.length > 0 && (
            <>
              {/* Non-admin with single org: just show the name, no dropdown */}
              {!isPlatformAdmin && clients.length === 1 ? (
                <div className="flex items-center h-8 px-2 text-xs text-gray-700">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  <span className="hidden sm:inline">{clients[0].name}</span>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-gray-700 hover:text-gray-900"
                      disabled={clientsLoading}
                    >
                      <Building2 className="h-3.5 w-3.5 mr-1.5" />
                      <span className="hidden sm:inline">{currentClient?.name || 'Admin'}</span>
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[200px]">
                    {isPlatformAdmin && (
                      <>
                        <DropdownMenuItem
                          onClick={() => setCurrentClient(null)}
                          className="text-xs cursor-pointer"
                        >
                          <div className="flex items-center justify-between w-full">
                            <span>Admin</span>
                            {!currentClient && <span className="text-blue-500">✓</span>}
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {clients.map((client) => (
                      <DropdownMenuItem
                        key={client.id}
                        onClick={() => setCurrentClient(client)}
                        className="text-xs cursor-pointer"
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{client.name}</span>
                          {currentClient?.id === client.id && (
                            <span className="text-blue-500">✓</span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}

          {/* Theme Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Toggle theme">
                {!mounted ? (
                  <Sun className="h-4 w-4" />
                ) : resolvedTheme === 'dark' ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[140px]">
              <DropdownMenuItem
                onClick={() => setTheme('light')}
                className="text-xs cursor-pointer"
              >
                <Sun className="h-3.5 w-3.5 mr-2" />
                Light
                {theme === 'light' && <span className="ml-auto text-blue-500">✓</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')} className="text-xs cursor-pointer">
                <Moon className="h-3.5 w-3.5 mr-2" />
                Dark
                {theme === 'dark' && <span className="ml-auto text-blue-500">✓</span>}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme('system')}
                className="text-xs cursor-pointer"
              >
                <Monitor className="h-3.5 w-3.5 mr-2" />
                System
                {theme === 'system' && <span className="ml-auto text-blue-500">✓</span>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notification Bell */}
          {session?.user && <NotificationBell onOpenPreferences={() => setNotifPrefsOpen(true)} />}

          {/* User Avatar Dropdown */}
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-primary to-blue-500 text-white text-xs font-medium">
                      {getInitials(session.user.email)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                </DropdownMenuLabel>
                {isPlatformAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setSettingsOpen(true)}
                      className="text-xs cursor-pointer"
                    >
                      <KeyRound className="h-3.5 w-3.5 mr-2" />
                      Keys
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setMemorySettingsOpen(true)}
                      className="text-xs cursor-pointer"
                    >
                      <Brain className="h-3.5 w-3.5 mr-2" />
                      Memories
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setMindMapOpen(true)}
                      className="text-xs cursor-pointer"
                    >
                      <BookOpen className="h-3.5 w-3.5 mr-2" />
                      Knowledge Base
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setNotifPrefsOpen(true)}
                  className="text-xs cursor-pointer"
                >
                  <Bell className="h-3.5 w-3.5 mr-2" />
                  Notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                  className="text-xs cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={() => signIn()}
              disabled={status === 'loading'}
              variant="default"
              size="sm"
              className="h-8 text-xs"
            >
              {status === 'loading' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5 mr-1.5" />
                  Login
                </>
              )}
            </Button>
          )}
        </div>
      </nav>

      {/* Dialogs rendered outside the dropdown */}
      {isPlatformAdmin && (
        <>
          <PlatformSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
          <MemorySettingsDialog open={memorySettingsOpen} onOpenChange={setMemorySettingsOpen} />
          <MindMapDialog open={mindMapOpen} onOpenChange={setMindMapOpen} />
        </>
      )}
      <NotificationPreferencesDialog open={notifPrefsOpen} onOpenChange={setNotifPrefsOpen} />
    </header>
  );
}
