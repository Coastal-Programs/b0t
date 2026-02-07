'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Key, Pencil, Check, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PLATFORM_CONFIGS } from '@/lib/workflows/platform-configs';
import { apiClient, APIError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { getSelectablePermissions } from '@/lib/oauth-service-configs';
import { Checkbox } from '@/components/ui/checkbox';

interface CredentialCardProps {
  credential: {
    id: string;
    platform: string;
    name: string;
    type: string;
    createdAt: Date | null;
    lastUsed: Date | null;
    isVerified?: boolean;
    isExpired?: boolean;
    connectedAccount?: string;
    metadata?: {
      selectedScopes?: string[];
      grantedScopes?: string[];
      serviceConfig?: string;
      connectedEmail?: string;
    };
  };
  onDeleted: () => void;
  onUpdated?: () => void;
}

export function CredentialCard({ credential, onDeleted, onUpdated }: CredentialCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState(credential.name);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [actualFields, setActualFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchedMetadata, setFetchedMetadata] = useState<{
    selectedScopes?: string[];
    grantedScopes?: string[];
    serviceConfig?: string;
    connectedEmail?: string;
  } | null>(null);
  const [selectedAdditionalScopes, setSelectedAdditionalScopes] = useState<string[]>([]);

  const platformConfig = PLATFORM_CONFIGS[credential.platform];

  // Check if this is an OAuth platform (outlook, google, etc.)
  const isOAuthPlatform = ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive', 'outlook', 'microsoft_teams', 'microsoft_onedrive', 'calcom', 'youtube', 'twitter'].includes(credential.platform);

  // OAuth connect handler
  const handleOAuthConnect = () => {
    // Map platform to auth route
    const authRouteMap: Record<string, string> = {
      'gmail': 'google',
      'google_calendar': 'google',
      'google_sheets': 'google',
      'google_docs': 'google',
      'google_drive': 'google',
      'outlook': 'outlook',
      'microsoft_teams': 'outlook',
      'microsoft_onedrive': 'outlook',
      'calcom': 'calcom',
      'youtube': 'youtube',
      'twitter': 'twitter',
    };

    const authPlatform = authRouteMap[credential.platform] || credential.platform.replace('_oauth_app', '');

    // Combine granted scopes with newly selected scopes
    const metadata = fetchedMetadata || credential.metadata;
    const grantedScopes = metadata?.grantedScopes || [];
    const allScopes = [...new Set([...grantedScopes, ...selectedAdditionalScopes])];

    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // Pass scopes, service, and update mode via query params
    const params = new URLSearchParams();
    if (allScopes.length > 0) {
      params.set('scopes', allScopes.join(','));
    }
    // Add service parameter for Google services
    if (metadata?.serviceConfig) {
      params.set('service', metadata.serviceConfig);
    }
    params.set('mode', 'update');
    params.set('credentialId', credential.id);

    const popup = window.open(
      `/api/auth/${authPlatform}/authorize?${params.toString()}`,
      `${authPlatform}-auth`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Listen for success message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === `${authPlatform}-auth-success`) {
        popup?.close();
        setEditDialogOpen(false);
        onUpdated?.(); // Refresh credentials list
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);
  };

  // Fetch actual credential values when edit dialog opens
  useEffect(() => {
    if (editDialogOpen) {
      setLoading(true);
      apiClient.get<{
        id: string;
        platform: string;
        name: string;
        metadata?: {
          selectedScopes?: string[];
          grantedScopes?: string[];
          serviceConfig?: string;
          connectedEmail?: string;
        };
        type: string;
        value?: string;
        fields?: Record<string, string>;
      }>(`/api/credentials/${credential.id}`)
        .then((data) => {
          // Store actual field values
          if (data.fields) {
            setActualFields(data.fields);
          } else if (data.value) {
            // Single field credential
            setActualFields({ value: data.value });
          }
          // Store metadata for OAuth platforms
          if (data.metadata) {
            setFetchedMetadata(data.metadata);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch credential details:', error);
          toast.error('Failed to load credential details');
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // Reset when dialog closes
      setActualFields({});
      setEditFields({});
      setFetchedMetadata(null);
      setSelectedAdditionalScopes([]);
    }
  }, [editDialogOpen, credential.id]);

  // Generate masked placeholders for sensitive fields only
  const getMaskedPlaceholder = (fieldKey: string, fieldType: string) => {
    if (fieldType === 'password' || fieldKey.toLowerCase().includes('secret')) {
      return '••••••••••••••••••••••••••••';
    }
    return 'Current value hidden';
  };

  // Check if field should be visible (not secret)
  const isVisibleField = (fieldKey: string, fieldType: string) => {
    // Client IDs and non-password fields are visible
    return !(fieldType === 'password' || fieldKey.toLowerCase().includes('secret'));
  };

  const handleDelete = async () => {
    toast(`Delete "${credential.name}"?`, {
      description: 'This cannot be undone.',
      action: {
        label: 'Delete',
        onClick: () => performDelete(),
      },
      cancel: {
        label: 'Cancel',
        onClick: () => {},
      },
    });
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.delete(`/api/credentials/${credential.id}`);

      toast.success('Credential deleted', {
        description: `"${credential.name}" has been removed.`,
      });
      onDeleted();
    } catch (error) {
      const message = error instanceof APIError ? error.message : 'Failed to delete credential';
      toast.error('Failed to delete credential', {
        description: message,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast.error('Credential name is required');
      return;
    }

    setSaving(true);
    try {
      // Check if single or multi-field credential
      const isSingleField = platformConfig.fields.length === 1;

      // Prepare the payload
      const payload: { name?: string; value?: string; fields?: Record<string, string> } = {};

      // Only update name if it changed
      if (editName !== credential.name) {
        payload.name = editName;
      }

      // Only include fields that were explicitly edited (present in editFields)
      // Don't send visible fields that are just being displayed
      if (Object.keys(editFields).length > 0) {
        if (isSingleField) {
          payload.value = editFields[platformConfig.fields[0].key];
        } else {
          payload.fields = editFields;
        }
      }

      // Only make the request if there's something to update
      if (Object.keys(payload).length === 0) {
        toast.info('No changes to save');
        setEditDialogOpen(false);
        return;
      }

      await apiClient.patch(`/api/credentials/${credential.id}`, payload);

      toast.success('Credential updated');
      setEditDialogOpen(false);
      setEditFields({});
      onUpdated?.();
    } catch (error) {
      const message = error instanceof APIError ? error.message : 'Failed to update credential';
      toast.error('Failed to update credential', {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString();
  };

  return (
    <Card className={cn(
      "relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all duration-300 hover:scale-[1.02]",
      credential.isVerified && "ring-2 ring-green-500/50"
    )}>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-blue-400 to-primary opacity-80" />
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="card-title">
            {credential.platform}
          </CardTitle>
          <div className="flex items-center gap-1">
            {credential.isVerified && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950"
                title="Account connected"
                disabled
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditDialogOpen(true)}
              title="Edit credential"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDelete}
              disabled={deleting}
              className="hover:text-destructive"
              title="Delete credential"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{credential.name}</span>
        </div>
        {credential.connectedAccount && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" />
            <span>{credential.connectedAccount}</span>
            {credential.isExpired && (
              <span className="text-red-500 ml-1">(Expired)</span>
            )}
          </div>
        )}
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Type:</span>
            <span className="font-medium">{credential.type}</span>
          </div>
          <div className="flex justify-between">
            <span>Last used:</span>
            <span>{formatDate(credential.lastUsed)}</span>
          </div>
          <div className="flex justify-between">
            <span>Created:</span>
            <span>{formatDate(credential.createdAt)}</span>
          </div>
        </div>
      </CardContent>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Credential</DialogTitle>
            {!isOAuthPlatform && (
              <DialogDescription>
                Update the name or value of this credential.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Show Name field only for non-OAuth platforms */}
            {!isOAuthPlatform && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Credential name"
                  disabled={saving}
                />
              </div>
            )}

            {/* Dynamic fields based on platform configuration */}
            {platformConfig?.fields.map((fieldConfig) => {
              const isVisible = isVisibleField(fieldConfig.key, fieldConfig.type);
              const actualValue = actualFields[fieldConfig.key];
              const displayValue = editFields[fieldConfig.key] !== undefined
                ? editFields[fieldConfig.key]
                : (isVisible ? actualValue || '' : '');

              return (
                <div key={fieldConfig.key} className="space-y-2">
                  <Label htmlFor={fieldConfig.key}>
                    {fieldConfig.label}
                    {!isVisible && (
                      <span className="text-xs text-muted-foreground ml-2">(Optional - leave blank to keep current value)</span>
                    )}
                  </Label>

                  {fieldConfig.type === 'textarea' ? (
                    <Textarea
                      id={fieldConfig.key}
                      placeholder={isVisible ? fieldConfig.label : getMaskedPlaceholder(fieldConfig.key, fieldConfig.type)}
                      value={displayValue}
                      onChange={(e) => setEditFields(prev => ({ ...prev, [fieldConfig.key]: e.target.value }))}
                      rows={4}
                      className="font-mono text-sm"
                      disabled={saving || loading}
                    />
                  ) : (
                    <Input
                      id={fieldConfig.key}
                      type={fieldConfig.type === 'password' ? 'text' : fieldConfig.type}
                      placeholder={isVisible ? fieldConfig.label : getMaskedPlaceholder(fieldConfig.key, fieldConfig.type)}
                      value={displayValue}
                      onChange={(e) => setEditFields(prev => ({ ...prev, [fieldConfig.key]: e.target.value }))}
                      disabled={saving || loading}
                    />
                  )}

                  {fieldConfig.description && (
                    <p className="text-xs text-muted-foreground">
                      {fieldConfig.description}
                    </p>
                  )}
                </div>
              );
            })}

            {/* OAuth Connection Status - shown for OAuth platforms */}
            {isOAuthPlatform && credential.connectedAccount && (
              <>
                {/* Email as main title */}
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">{credential.connectedAccount}</h3>
                  <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    <span>Account connected</span>
                    {credential.isExpired && (
                      <span className="text-red-500 ml-1">(Expired - reconnect required)</span>
                    )}
                  </div>
                </div>

                {/* Permissions in grey box */}
                {(() => {
                  const metadata = fetchedMetadata || credential.metadata;
                  const grantedScopes = metadata?.grantedScopes || [];
                  const serviceId = credential.platform; // 'outlook', 'google', etc.
                  const selectablePermissions = getSelectablePermissions(serviceId);

                  if (selectablePermissions.length > 0) {
                    return (
                      <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                        <Label className="text-sm font-medium">Select permissions:</Label>
                        <div className="space-y-3">
                          {selectablePermissions.map((permission) => {
                            const isGranted = grantedScopes.includes(permission.scope);
                            const isSelected = selectedAdditionalScopes.includes(permission.scope);

                            return (
                              <div
                                key={permission.scope}
                                className={cn(
                                  "flex items-start space-x-3",
                                  isGranted && "opacity-60"
                                )}
                              >
                                <Checkbox
                                  id={`perm-${permission.scope}`}
                                  checked={isGranted || isSelected}
                                  disabled={isGranted}
                                  onCheckedChange={(checked) => {
                                    if (!isGranted) {
                                      if (checked) {
                                        setSelectedAdditionalScopes(prev => [...prev, permission.scope]);
                                      } else {
                                        setSelectedAdditionalScopes(prev => prev.filter(s => s !== permission.scope));
                                      }
                                    }
                                  }}
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0">
                                  <label
                                    htmlFor={`perm-${permission.scope}`}
                                    className="text-sm font-medium leading-none cursor-pointer"
                                  >
                                    {permission.label}
                                    {isGranted && <span className="text-xs text-muted-foreground ml-2">(granted)</span>}
                                  </label>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {permission.description}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Divider */}
                <div className="border-t border-border"></div>

                {/* OAuth app configured section */}
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">OAuth app configured</h3>
                  <p className="text-sm text-muted-foreground">
                    Reconnect your {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(credential.platform) ? 'Microsoft' : ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive'].includes(credential.platform) ? 'Google' : credential.platform === 'youtube' ? 'YouTube' : 'Twitter'} account to get started
                  </p>
                </div>

                {/* Reconnect button in grey box */}
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <Button
                    type="button"
                    onClick={handleOAuthConnect}
                    className="w-full bg-white dark:bg-white hover:bg-black dark:hover:bg-black text-black dark:text-black hover:text-white dark:hover:text-white border border-gray-300 hover:border-black shadow-sm hover:shadow-md transition-all font-medium"
                    variant="outline"
                  >
                    {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(credential.platform) && (
                      <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23" fill="none">
                        <rect width="23" height="23" rx="4" fill="url(#microsoft-gradient-edit-full)"/>
                        <path d="M1 1h10v10H1z" fill="#f25022"/>
                        <path d="M12 1h10v10H12z" fill="#00a4ef"/>
                        <path d="M1 12h10v10H1z" fill="#7fba00"/>
                        <path d="M12 12h10v10H12z" fill="#ffb900"/>
                        <defs>
                          <linearGradient id="microsoft-gradient-edit-full" x1="0" y1="0" x2="23" y2="23">
                            <stop offset="0%" stopColor="#f25022"/>
                            <stop offset="100%" stopColor="#ffb900"/>
                          </linearGradient>
                        </defs>
                      </svg>
                    )}
                    {['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive'].includes(credential.platform) && (
                      <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    )}
                    {credential.platform === 'youtube' && (
                      <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF0000">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                    )}
                    {credential.platform === 'twitter' && (
                      <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#1DA1F2">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    )}
                    Sign in with {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(credential.platform) ? 'Microsoft' : ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive'].includes(credential.platform) ? 'Google' : credential.platform === 'youtube' ? 'YouTube' : 'Twitter'}
                  </Button>
                </div>
              </>
            )}

            {/* Not connected state for OAuth platforms */}
            {isOAuthPlatform && !credential.connectedAccount && (
              <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-5 w-5 rounded-full bg-yellow-500/10 flex items-center justify-center">
                      <ShieldCheck className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      OAuth app configured
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Connect your {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(credential.platform) ? 'Microsoft' : credential.platform === 'google' ? 'Google' : credential.platform === 'calcom' ? 'Cal.com' : credential.platform === 'youtube' ? 'YouTube' : 'Twitter'} account
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleOAuthConnect}
                  className="w-full bg-white dark:bg-white hover:bg-black dark:hover:bg-black text-black dark:text-black hover:text-white dark:hover:text-white border border-gray-300 hover:border-black shadow-sm hover:shadow-md transition-all font-medium"
                  variant="outline"
                >
                  {credential.platform === 'outlook' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23" fill="none">
                      <rect width="23" height="23" rx="4" fill="url(#microsoft-gradient-edit-not-connected)"/>
                      <path d="M1 1h10v10H1z" fill="#f25022"/>
                      <path d="M12 1h10v10H12z" fill="#00a4ef"/>
                      <path d="M1 12h10v10H1z" fill="#7fba00"/>
                      <path d="M12 12h10v10H12z" fill="#ffb900"/>
                      <defs>
                        <linearGradient id="microsoft-gradient-edit-not-connected" x1="0" y1="0" x2="23" y2="23">
                          <stop offset="0%" stopColor="#f25022"/>
                          <stop offset="100%" stopColor="#ffb900"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  )}
                  {['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive'].includes(credential.platform) && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                  {credential.platform === 'youtube' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF0000">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  )}
                  {credential.platform === 'calcom' && (
                    <svg className="h-5 mr-2" viewBox="0 0 512 512" style={{ width: '80px' }}>
                      <path d="M458 512H56c-30.4 0-55-24.6-55-55V55C1 24.6 25.6 0 56 0h402c30.4 0 55 24.6 55 55v402c0 30.4-24.6 55-55 55" fill="#292929"/>
                      <path d="M162.8 347.3c-50.4 0-88.4-39.9-88.4-89.3s35.9-89.6 88.4-89.6c27.9 0 47 8.6 62.1 28l-24.3 20.1c-10.1-10.8-22.5-16.2-37.8-16.2-34.1 0-52.8 26.1-52.8 57.6s20.5 57.1 52.8 57.1c15.1 0 28-5.3 38.4-16.2l23.9 21c-14.5 18.9-34.3 27.5-62.3 27.5m166.4-131.2h32.7v128.1h-32.7v-18.7c-6.7 13.2-18.1 22.2-39.7 22.2-34.6 0-62.3-30.1-62.3-66.9 0-37 27.7-66.9 62.3-66.9 21.5 0 33 8.9 39.7 22.2zm1.1 64.5c0-20-13.8-36.6-35.4-36.6-20.8 0-34.4 16.7-34.4 36.6 0 19.4 13.6 36.6 34.4 36.6 21.4 0 35.4-16.7 35.4-36.6A385 164.3h32.7v179.6H385z" fill="#fff"/>
                    </svg>
                  )}
                  {credential.platform === 'twitter' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#1DA1F2">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  )}
                  Sign in with {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(credential.platform) ? 'Microsoft' : ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_drive'].includes(credential.platform) ? 'Google' : credential.platform === 'calcom' ? 'Cal.com' : credential.platform === 'youtube' ? 'YouTube' : 'Twitter'}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setEditName(credential.name);
                setEditFields({});
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || (!isOAuthPlatform && !editName.trim())}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
