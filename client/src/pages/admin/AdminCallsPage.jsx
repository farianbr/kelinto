import { callLogSchema } from '@shared/schemas/admin';
import ChannelScreen from '@/components/admin/marketing/ChannelScreen';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';

/**
 * Calls (§6.13 · §6b U5).
 *
 * The odd one of the four: there is nothing to send. This records a
 * conversation that already happened on a phone, in either direction, so its
 * messages are `logged` rather than `queued_unconfigured` and no provider
 * notice appears - nothing here is waiting on a key.
 *
 * What *is* deferred is click-to-dial, recording fetch and call analysis, all
 * of which need a telephony provider (§6b U5). The hint below says so, so the
 * screen is not mistaken for a broken dialler.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/marketing/calls'], icon: adminIcon('Phone') };

export function AdminCallsPage() {
  return (
    <ChannelScreen
      channel="call"
      page={ADMIN_PAGE}
      schema={callLogSchema}
      showDirection
      showRecording
      submitLabel="Log call"
      bodyLabel="Notes"
      bodyPlaceholder="Asked about lead time on iPhone 14 OLED assemblies. Quoted 3 days."
      hint="This logs a call that has already happened. Dialling from the ERP, fetching recordings and call analysis all need a telephony provider and are not connected yet."
    />
  );
}

export default AdminCallsPage;
