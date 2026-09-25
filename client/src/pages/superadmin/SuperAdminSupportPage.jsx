import { useState } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { Check, LifeBuoy, MessageSquare } from 'lucide-react';

import cn from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import SupportThread from '@/components/support/SupportThread';
import {
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformSkeleton,
  PlatformPanel,
} from '@/components/superadmin/PlatformUI';
import { PlatformConfirm } from '@/components/superadmin/PlatformForm';
import { useSupportThread, useSupportThreads, useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { usePlatformDirectory } from '@/components/superadmin/platformData';

/**
 * Support conversations, as an inbox.
 *
 * **Two panes on a desktop, one at a time on a phone.** The list stays beside
 * the open thread so moving from one tenant to the next is one click, the way
 * every mail client works; on a phone the thread takes the screen and the
 * breadcrumb is the way back. Each thread has its own URL, so "the Northline
 * conversation" can be linked from the overview's queue.
 *
 * Opening a thread marks it read for the platform (the server does that on
 * fetch), which is why the list, not the thread, feeds every unread badge.
 */

function ThreadList({ threads, activeId }) {
  if (!threads.length) {
    return (
      <PlatformEmpty
        icon={MessageSquare}
        title="No conversations yet"
        body="A tenant writes from their own ERP, or you start one from a tenant's Messages tab."
      />
    );
  }
  return (
    <ul className="divide-y divide-plat-line-soft">
      {threads.map((thread) => (
        <li key={thread.id}>
          <NavLink
            to={`/superadmin/support/${thread.tenant}`}
            className={cn(
              'block px-4 py-3 transition-colors duration-fast',
              thread.tenant === activeId ? 'bg-plat-accent/10' : 'hover:bg-plat-text/3',
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-md', thread.unread ? 'font-semibold text-plat-text' : 'font-medium text-plat-muted')}>
                {thread.tenantName}
              </span>
              <span className="shrink-0 text-xs text-plat-dim">{relativeTime(thread.lastMessageAt)}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-plat-dim">{thread.preview || 'No messages yet'}</span>
              {thread.unread > 0 && <PlatformBadge tone="danger">{thread.unread} new</PlatformBadge>}
              {thread.status === 'resolved' && <PlatformBadge>resolved</PlatformBadge>}
            </span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function ThreadPane({ tenantId, tenantName }) {
  const { data, isLoading } = useSupportThread(tenantId);
  const { replyToThread, resolveThread } = useSuperAdminMutations();
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const thread = data?.thread;

  if (isLoading) return <PlatformSkeleton className="h-full min-h-96 rounded-xl" />;

  return (
    <PlatformPanel
      title={tenantName}
      description={
        <Link to={`/superadmin/tenants/${tenantId}`} className="hover:underline">
          Open tenant
        </Link>
      }
      action={
        thread?.status === 'open' && (
          <PlatformButton variant="secondary" size="sm" icon={Check} onClick={() => setResolving(true)}>
            Mark resolved
          </PlatformButton>
        )
      }
    >
      <div className="flex h-[62vh] min-h-96 flex-col">
        <SupportThread
          thread={thread}
          side="platform"
          surface="platform"
          isSending={replyToThread.isPending}
          error={error}
          placeholder={`Reply to ${tenantName}…`}
          emptyBody="Nothing here yet. A message you send starts the conversation."
          onSend={(body, { onSuccess }) => {
            setError(null);
            replyToThread.mutate({ id: tenantId, body }, { onSuccess, onError: (err) => setError(err.message) });
          }}
        />
      </div>

      <PlatformConfirm
        open={resolving}
        onClose={() => setResolving(false)}
        title={`Mark the ${tenantName} conversation resolved?`}
        confirmLabel="Mark resolved"
        isPending={resolveThread.isPending}
        error={resolveThread.error?.message}
        onConfirm={() =>
          resolveThread.mutate(
            { id: tenantId },
            {
              onSuccess: () => {
                toast.ok('Conversation resolved', tenantName);
                setResolving(false);
              },
            },
          )
        }
      >
        <p>It moves out of the open list. If {tenantName} writes again it reopens by itself.</p>
      </PlatformConfirm>
    </PlatformPanel>
  );
}

export function SuperAdminSupportPage() {
  const { tenantId } = useParams();
  const { data, isLoading } = useSupportThreads();
  const { tenantById } = usePlatformDirectory();
  if (isLoading) return <PlatformPageSkeleton />;

  const threads = data?.threads ?? [];
  // A tenant nobody has written to has no thread yet, so its name comes from
  // the directory rather than the list.
  const open = threads.find((thread) => thread.tenant === tenantId) ?? {
    tenantName: tenantById.get(tenantId)?.name,
  };
  const unread = threads.reduce((sum, thread) => sum + (thread.unread ?? 0), 0);

  return (
    <>
      <PlatformHeader
        crumbs={[
          { label: 'Overview', to: '/superadmin' },
          { label: 'Support', to: tenantId ? '/superadmin/support' : undefined },
          ...(tenantId ? [{ label: open?.tenantName ?? 'Conversation' }] : []),
        ]}
        title="Support"
        description={unread ? `${unread} unread message${unread === 1 ? '' : 's'}.` : 'Every conversation is read.'}
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={cn('overflow-hidden rounded-xl border border-plat-line bg-plat-surface self-start', tenantId && 'hidden lg:block')}>
          <ThreadList threads={threads} activeId={tenantId} />
        </div>

        {tenantId ? (
          <ThreadPane key={tenantId} tenantId={tenantId} tenantName={open?.tenantName ?? 'Tenant'} />
        ) : (
          <div className="hidden rounded-xl border border-dashed border-plat-line lg:flex lg:items-center lg:justify-center">
            <PlatformEmpty icon={LifeBuoy} title="Choose a conversation" body="Unread ones are listed in bold." />
          </div>
        )}
      </div>
    </>
  );
}

export default SuperAdminSupportPage;
