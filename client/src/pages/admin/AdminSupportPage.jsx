import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import api from '@/lib/api';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import SupportThread from '@/components/support/SupportThread';

/**
 * The tenant's line to the platform (SAAS_PLATFORM §4.5).
 *
 * **The other end of the console's Support section**, rendered from the same
 * component with `side="tenant"`. A reply from us is badged as Platform, which
 * is the point: it must not read as a message from one of their own staff.
 *
 * **Reachable while the account is past due or suspended.** Those states refuse
 * writes everywhere else, and this is deliberately not among them - an account
 * in trouble is exactly the one that needs to reach us, and a support channel
 * that switches off with the subscription is a support channel that is missing
 * when it matters. The route carries no feature gate for the same reason.
 */

function useMyThread() {
  return useQuery({
    queryKey: ['admin', 'support'],
    queryFn: () => api.get('/admin/support'),
    // A reply from the platform arrives unprompted, so the screen checks for
    // itself rather than waiting to be reloaded.
    refetchInterval: 30 * 1000,
  });
}

export function AdminSupportPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useMyThread();
  const [error, setError] = useState(null);

  const send = useMutation({
    mutationFn: (body) => api.post('/admin/support', { body }),
    onSuccess: (result) => {
      // The response carries the whole thread, so the list updates without a
      // second round trip.
      queryClient.setQueryData(['admin', 'support'], result);
      queryClient.invalidateQueries({ queryKey: ['admin', 'support', 'unread'] });
    },
  });

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-4 h-64 w-full" />
      </>
    );
  }

  const thread = data?.thread;

  return (
    <>
      <PageHeader
        icon={LifeBuoy}
        title="Support"
        description="Message the Kelinto team."
      />

      <Panel>
        {/*
          A business belonging to no tenant has nobody to write to. That is the
          normal state for a business not run through the platform, so it gets
          an explanation rather than an error.
        */}
        {!thread ? (
          <p className="py-8 text-center text-sm text-ink-500">
            This business is not part of a Kelinto account, so there is no support channel here.
          </p>
        ) : (
          <div className="flex h-[60vh] flex-col">
            <SupportThread
              thread={thread}
              side="tenant"
              isSending={send.isPending}
              error={error}
              placeholder="Describe what you need…"
              emptyBody="Nothing here yet. Send a message and the Kelinto team will reply."
              onSend={(body, { onSuccess }) => {
                setError(null);
                send.mutate(body, { onSuccess, onError: (err) => setError(err.message) });
              }}
            />
          </div>
        )}
      </Panel>
    </>
  );
}

export default AdminSupportPage;
