import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Building2, Check, Mail } from 'lucide-react';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/admin/PageHeader';
import { relativeTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import { useSupplierSession, useSupplierPortalMutations } from '@/hooks/useSupplierPortal';

/**
 * The businesses one supplier account works with, and the ones asking to.
 *
 * One login on the platform can supply several businesses, and each keeps its
 * own orders, agreements and terms with them. This is where the supplier sees
 * all of them, answers invitations, and chooses which one to work in - the rest
 * of the portal shows one business at a time.
 *
 * Also the screen a supplier lands on when signed in but working nowhere yet:
 * a new account whose only business is still an invitation.
 */
export function SupplierBusinessesPage() {
  const navigate = useNavigate();
  const { business: current, businesses, invitations } = useSupplierSession();
  const { switchBusiness, acceptInvitation, declineInvitation } = useSupplierPortalMutations();
  const [answering, setAnswering] = useState(null);

  const open = (target) =>
    switchBusiness.mutate(target.id, {
      onSuccess: () => navigate('/supplier'),
      onError: (error) => toast.error(`Could not open ${target.name}`, error.message),
    });

  const answer = () => {
    const { invitation, accept } = answering;
    const mutation = accept ? acceptInvitation : declineInvitation;
    mutation.mutate(invitation.id, {
      onSuccess: () => {
        setAnswering(null);
        if (accept) {
          toast.ok('Invitation accepted', `You now supply ${invitation.name}.`);
          navigate('/supplier');
        } else {
          toast.ok('Invitation declined', `${invitation.name} will not send you requests.`);
        }
      },
    });
  };

  const pending = acceptInvitation.isPending || declineInvitation.isPending;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Businesses"
        description="Everyone you supply on Kelinto. Each keeps its own orders and agreements with you."
      />

      {invitations.length > 0 && (
        <Panel title="Invitations" description="These businesses would like you as a supplier." className="mb-4">
          <ul className="flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2.5"
              >
                {/* The business takes the whole first line on a phone, with the
                    two answers beneath it: who is asking is the thing being
                    decided, and it cannot be three letters wide. */}
                <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
                  <Mail className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-md text-ink-900">{invitation.name}</span>
                    <span className="block text-xs text-ink-400">
                      Invited {relativeTime(invitation.invitedAt)}
                    </span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAnswering({ invitation, accept: false })}
                  >
                    Decline
                  </Button>
                  <Button size="sm" onClick={() => setAnswering({ invitation, accept: true })}>
                    <Check className="size-4" strokeWidth={2} aria-hidden="true" />
                    Accept
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Your businesses">
        {businesses.length ? (
          <ul className="flex flex-col gap-2">
            {businesses.map((item) => {
              const here = current?.id === item.id;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5"
                >
                  <Building2 className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-md text-ink-900">{item.name}</span>
                  {here ? (
                    <Badge tone="brand" size="sm">
                      Working here
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={switchBusiness.isPending && switchBusiness.variables === item.id}
                      disabled={switchBusiness.isPending}
                      onClick={() => open(item)}
                    >
                      Open
                      <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <PanelEmpty
            icon={Building2}
            title={invitations.length ? 'Accept an invitation to start' : 'No business yet'}
            body={
              invitations.length
                ? 'Once you accept, that business appears here and its requests for quote reach you.'
                : 'When a business on Kelinto adds you as a supplier, its invitation appears here.'
            }
          />
        )}
      </Panel>

      <ConfirmDialog
        open={Boolean(answering)}
        onClose={() => setAnswering(null)}
        onConfirm={answer}
        tone={answering?.accept ? 'info' : 'warn'}
        title={
          answering?.accept
            ? `Start supplying ${answering?.invitation.name}?`
            : `Decline ${answering?.invitation.name ?? ''}?`
        }
        body={
          answering?.accept
            ? `${answering?.invitation.name} will be able to send you requests for quote and agreements to sign. Your other businesses do not see anything of theirs, or they of yours.`
            : `${answering?.invitation.name ?? 'They'} will not be able to send you requests for quote. They can invite you again later.`
        }
        confirmLabel={answering?.accept ? 'Accept invitation' : 'Decline invitation'}
        loading={pending}
        error={(answering?.accept ? acceptInvitation : declineInvitation).error?.message}
      />
    </div>
  );
}

export default SupplierBusinessesPage;
