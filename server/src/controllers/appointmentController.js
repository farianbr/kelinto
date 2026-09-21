import { asyncHandler } from '../utils/ApiError.js';
import { TICKET_OPEN_STATUSES } from '../models/Ticket.js';
import {
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
} from '../models/Appointment.js';
import { db } from '../db/models.js';
import '../models/User.js';
// Registered explicitly, like User above: `db().Ticket` compiles from the
// default connection's schema, so the module has to have been loaded.
import '../models/Ticket.js';

/**
 * The scheduling board (§6.15 category 4 - **UI only, §6b U1–U2**, phase 11e).
 *
 * **Read-only, and there is deliberately no write route.** §6b rule 4: nothing
 * fakes success. A `POST` here would accept a booking the business has not
 * decided the shape of yet (§12 Q1) and store it against a model that may still
 * change - so the dialog on the screen is disabled rather than wired to an
 * endpoint that would quietly work.
 *
 * The collection ships empty, so both screens render their real chrome around
 * nothing. That is §6b rule 3 working as intended: turning this on later is a
 * service being written, not a migration.
 */

const list = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const filter = {};
  if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = new Date(from);
    if (to) filter.startAt.$lte = new Date(to);
  }

  const [scheduled, unscheduled, jobs, staff] = await Promise.all([
    db().Appointment.find(filter).sort({ startAt: 1 }).lean(),
    // The tray beside the board: everything with no date yet.
    db().Appointment.find({ startAt: null, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).lean(),

    /**
     * Open repair tickets carrying no due date - the work the board cannot
     * show because nobody has said when it happens.
     *
     * **Tickets, not appointments.** An appointment is a slot somebody booked;
     * a ticket is a device on the bench. The tray beside the calendar was
     * reading appointments only, so a shop with twenty repairs in progress and
     * no bookings saw an empty board and an empty tray - which is the case
     * where knowing what is unscheduled matters most.
     *
     * Open statuses only: a completed or cancelled ticket has no slot left to
     * need. Capped, because this is a prompt to schedule rather than a
     * worklist - a shop with three hundred open tickets has a different
     * problem than this panel can help with.
     */
    db()
      .Ticket.find({
        status: { $in: TICKET_OPEN_STATUSES },
        $or: [{ dueDate: null }, { dueDate: { $exists: false } }],
      })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate('technician', 'contactName businessName email')
      .lean(),

    // Who the board can be filtered by. Read live rather than hard-coded so the
    // filter is right the moment a staff account is added.
    db().User.find({ role: { $in: ['admin', 'staff'] } }).select('contactName businessName email').lean(),
  ]);

  const shape = (row) => ({
    id: row._id.toString(),
    kind: row.kind,
    title: row.title,
    notes: row.notes ?? '',
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    staff: row.staff ? row.staff.toString() : null,
    relatedTo: row.relatedTo ?? null,
  });

  /**
   * A ticket as the board draws it.
   *
   * The device is the first one on the ticket: a ticket may hold several,
   * but a card three lines tall can show one, and the first is the one the
   * counter wrote down. `deviceBrand`/`deviceModel` are the older single-
   * device fields, kept as the fallback so tickets written before the list
   * existed still render.
   */
  const shapeJob = (row) => {
    const first = row.devices?.[0];
    const device =
      [first?.brand ?? row.deviceBrand, first?.model ?? row.deviceModel]
        .filter(Boolean)
        .join(' ') || 'Device not named';

    const tech = row.technician;

    return {
      id: row._id.toString(),
      ticketNumber: row.ticketNumber,
      device,
      customerName: row.customerName ?? "",
      status: row.status,
      priority: row.priority ?? null,
      technician: tech ? tech.contactName || tech.businessName || tech.email : null,
      createdAt: row.createdAt,
    };
  };

  res.json({
    appointments: scheduled.map(shape),
    unscheduled: unscheduled.map(shape),
    jobs: jobs.map(shapeJob),
    staff: staff.map((person) => ({
      id: person._id.toString(),
      name: person.contactName || person.businessName || person.email,
    })),
    kinds: APPOINTMENT_KINDS,
    statuses: APPOINTMENT_STATUSES,
    // Stated by the server rather than assumed by the screen, so the notice and
    // the capability cannot drift apart.
    wired: false,
  });
});

export { list };
