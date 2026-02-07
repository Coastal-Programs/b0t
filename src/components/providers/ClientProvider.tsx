'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import useSWR from 'swr';

export interface Client {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  plan: string;
  status: 'active' | 'inactive';
  createdAt: string;
  memberCount?: number;
}

interface ClientContextType {
  currentClient: Client | null;
  clients: Client[];
  setCurrentClient: (client: Client | null) => void;
  isLoading: boolean;
  refetchClients: () => Promise<void>;
  isPlatformAdmin: boolean;
}

const ClientContext = createContext<ClientContextType>({
  currentClient: null,
  clients: [],
  setCurrentClient: () => {},
  isLoading: true,
  refetchClients: async () => {},
  isPlatformAdmin: false,
});

// Fetcher function for SWR
const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch');
  const data = await response.json();
  return data.clients || [];
};

export function ClientProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const isPlatformAdmin = (session?.user as { isPlatformAdmin?: boolean } | undefined)?.isPlatformAdmin ?? false;
  const [currentClient, setCurrentClientState] = useState<Client | null>(null);

  // Use SWR for caching clients data
  const shouldFetch = status === 'authenticated' && session?.user?.id;
  const { data: clients = [], isLoading, mutate } = useSWR<Client[]>(
    shouldFetch ? '/api/clients' : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000, // Cache for 30 seconds
    }
  );

  const fetchClients = async () => {
    await mutate();
  };

  const setCurrentClient = (client: Client | null) => {
    // Block non-admins from entering Admin mode (client === null)
    if (!client && !isPlatformAdmin) return;

    // Only show toast if there's a previous client (user is switching, not initial load)
    if (currentClient && client && currentClient.id !== client.id) {
      toast.success(`Switched to ${client.name}`, {
        description: client.status === 'inactive' ? 'This client is currently inactive' : undefined,
        duration: 2000,
      });
    } else if (currentClient && !client) {
      toast.success('Switched to Admin view', {
        duration: 2000,
      });
    }

    setCurrentClientState(client);
    // Store in localStorage for persistence
    if (typeof window !== 'undefined') {
      if (client) {
        localStorage.setItem('currentClientId', client.id);
      } else {
        // Store 'admin' to distinguish from no preference
        localStorage.setItem('currentClientId', 'admin');
      }
    }
  };

  // Restore from localStorage on mount
  useEffect(() => {
    if (clients.length > 0 && !currentClient) {
      const storedClientId = localStorage.getItem('currentClientId');

      if (storedClientId === 'admin' && isPlatformAdmin) {
        // User had Admin selected — only restore for platform admins
        setCurrentClientState(null);
      } else if (storedClientId && storedClientId !== 'admin') {
        // Try to find the stored client
        const stored = clients.find(c => c.id === storedClientId);
        if (stored) {
          setCurrentClientState(stored);
        } else {
          // Stored client not found (maybe deleted), default to first client
          setCurrentClientState(clients[0]);
        }
      } else {
        // No stored preference or non-admin with 'admin' stored, default to first client
        setCurrentClientState(clients[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, isPlatformAdmin]);

  return (
    <ClientContext.Provider value={{ currentClient, clients, setCurrentClient, isLoading, refetchClients: fetchClients, isPlatformAdmin }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  return useContext(ClientContext);
}
