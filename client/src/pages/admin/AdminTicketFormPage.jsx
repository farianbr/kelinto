import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import TicketForm from '@/components/admin/TicketForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import {
  useAdminTicket,
  useAdminTickets,
  useAdminUsers,
  useAdminServices,
  useAdminMutations,
} from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * Taking a ticket in, on its own screen rather than in a modal.
 *
 * **Why a route and not a dialog.** Intake is not a short form: a device block
 * alone carries four identifiers, three free-text fields and an eight-row
 * condition grid, and a ticket can hold several. At that size a modal is a
 * scrolling box floating over a list nobody is reading, it cannot be linked to
 * or refreshed, and it cannot be opened in a second tab - which is exactly what
 * somebody does when they are copying details off a device in one hand.
 *
 * A route also means "back" behaves: cancelling returns to the list, and the
 * URL says what is on screen. Same reasoning as `AdminCustomerEditPage`.
 */
const NEW_PAGE = { ...ADMIN_ROUTES['/admin/tickets/new'], icon: adminIcon('ClipboardList') };

export function AdminTicketFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const editing = Boolean(id);

  const { createTicket, updateTicket } = useAdminMutations();

  /**
   * The ticket being edited, read on its own.
   *
   * This used to fetch the list's newest 200 and look for the id in them, from
   * before `GET /admin/tickets/:id` existed - so the 201st ticket opened onto
   * "Ticket not found" while it sat on the list one page down.
   */
  const { data: ticketData, isLoading } = useAdminTicket(editing ? id : undefined);
  const ticket = ticketData?.ticket;

  // The technicians ride along with the list, which is readable at the
  // permission level a counter has (see `ticketService.listTechnicians`).
  const { data: listData } = useAdminTickets({ status: 'all', limit: 5 });
  const technicians = listData?.technicians ?? [];

  /**
   * Accounts offered by the customer picker.
   *
   * No `status` filter, unlike the quote and the invoice builders: those
   * price and bill, while a repair is taken in from whoever walks up - a
   * pending account is still a person with a broken phone, and a kiosk
   * check-in opens one.
   */
  const { data: clientData } = useAdminUsers({ limit: 500 });
  const clients = clientData?.users ?? [];

  // What the service picker lists: the shop's own price book.
  const { data: serviceData } = useAdminServices({ status: 'active', limit: 200 });
  const services = serviceData?.services ?? [];

  useSetRecordLabel(ticket?.ticketNumber);

  /**
   * The account the ticket was raised for, from `?client=<id>`: the customer
   * profile's "Ticket" button and `+ Create > Ticket` both arrive with it.
   */
  const seed = { client: searchParams.get('client') ?? undefined };

  const page = editing
    ? {
        ...ADMIN_ROUTES['/admin/tickets/:id'],
        icon: adminIcon('ClipboardList'),
        title: ticket ? `Edit ${ticket.ticketNumber}` : 'Edit ticket',
      }
    : NEW_PAGE;

  if (editing && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (editing && !ticket) {
    return (
      <>
        <PageHeader icon={page.icon} title="Ticket not found" />
        <p className="text-sm text-ink-500">
          It may have been deleted.{' '}
          <Link to="/admin/tickets" className="font-semibold text-brand underline">
            Back to tickets
          </Link>
        </p>
      </>
    );
  }

  return (
    /* Measured, not full-bleed. Intake is a form, and a form the width of a
       27-inch monitor puts the label at one edge and the value at the other.
       `.record-page` rather than `.form-page`: this carries device blocks and
       priced lines, which are tables and need more than a 760px column. */
    <div className="record-page">
      <Link
        to={editing ? `/admin/tickets/${id}` : '/admin/tickets'}
        className={cn(pressable, 'mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        {editing ? `Back to ${ticket.ticketNumber}` : 'Back to tickets'}
      </Link>

      <PageHeader icon={page.icon} title={page.title} description={page.description} />

      <Panel>
        <TicketForm
          // Keyed by the record, so the form's defaults are read once the
          // ticket has arrived rather than frozen on the empty first render.
          key={ticket?.id ?? 'new'}
          ticket={ticket}
          seed={seed.client ? seed : undefined}
          technicians={technicians}
          clients={clients}
          services={services}
          isPending={editing ? updateTicket.isPending : createTicket.isPending}
          error={(editing ? updateTicket : createTicket).error?.message}
          onCancel={() => navigate(editing ? `/admin/tickets/${id}` : '/admin/tickets')}
          onSubmit={(values) => {
            const mutation = editing ? updateTicket : createTicket;
            mutation.mutate(editing ? { id, ...values } : values, {
              onSuccess: (result) => {
                toast.ok(
                  editing ? 'Ticket saved' : 'Ticket opened',
                  editing ? undefined : 'It is now on the repair board.',
                );
                const next = result?.ticket?.id ?? id;
                navigate(next ? `/admin/tickets/${next}` : '/admin/tickets');
              },
            });
          }}
        />
      </Panel>
    </div>
  );
}

export default AdminTicketFormPage;
