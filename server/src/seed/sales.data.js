/**
 * Demo quotes and returns (ERP rework §6.3, §6.6).
 *
 * Both land in every state their screens have to render, for the same reason
 * the purchase seed does: a dataset where everything is `resolved` teaches
 * nothing about the screen. Nothing hard-codes a SKU - lines are drawn from
 * real orders and the seeded catalogue, so a regenerated catalogue cannot leave
 * a dangling reference.
 */

const DAY = 86_400_000;

function daysAgo(n) {
  const date = new Date(Date.now() - n * DAY);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysAhead(n) {
  return daysAgo(-n);
}

/**
 * Six quotes across the five states the list filters on.
 *
 * `expiresIn` is a positive number of days ahead or a negative number behind
 * the negative one is the row that has to read as **expired**, which the server
 * derives from the date rather than storing.
 */
const QUOTE_PLANS = [
  { lines: 3, offset: 0, createdDaysAgo: 1, expiresIn: 29, status: 'draft', discount: 0.95, notes: 'Awaiting confirmation on the screen revision.' },
  { lines: 4, offset: 3, createdDaysAgo: 5, expiresIn: 25, status: 'sent', discount: 0.92, notes: '' },
  { lines: 2, offset: 7, createdDaysAgo: 9, expiresIn: 21, status: 'accepted', discount: 0.9, notes: 'Client confirmed by phone.' },
  // Past its date and still open - the derived `expired` row.
  { lines: 3, offset: 9, createdDaysAgo: 45, expiresIn: -8, status: 'sent', discount: 0.93, notes: 'No answer after two follow-ups.' },
  { lines: 5, offset: 12, createdDaysAgo: 21, expiresIn: 9, status: 'sent', discount: 0.88, notes: 'Volume pricing on the battery lines.' },
  { lines: 2, offset: 17, createdDaysAgo: 60, expiresIn: -30, status: 'rejected', discount: 0.97, notes: 'Went with another supplier on price.' },
];

/**
 * `products` is the seeded catalogue, `users` the approved buyers, and `rate`
 * the provincial rate to tax at. Totals are computed here exactly as
 * `quoteService.recomputeTotals` does, so a seeded quote cannot disagree with
 * one the running code would produce.
 */
/**
 * `startSequence` lets a second batch of quotes continue this one's numbering:
 * `quoteNumber` is uniquely indexed, so two batches both starting at 1 would
 * collide on insert. Repair quotes are a separate model (`ServiceQuote`) and
 * are seeded by `seed:demo -- sales`.
 */
function buildQuotes({
  products,
  users,
  rate = 0.13,
  year = new Date().getFullYear(),
  startSequence = 1,
}) {
  if (!products.length || !users.length) return [];

  let sequence = startSequence;
  let cursor = 0;

  return QUOTE_PLANS.map((plan, index) => {
    const user = users[index % users.length];

    const items = Array.from({ length: plan.lines }, (_, i) => {
      const product = products[(plan.offset + cursor + i) % products.length];
      const qty = 5 + ((index + i) % 4) * 5;
      // A quote is a negotiated number, so it sits below list - that is the
      // whole reason a client asks for one.
      const unitPrice = Math.max(1, Math.round(product.price * plan.discount));

      return {
        product: product._id,
        sku: product.sku,
        name: product.name,
        qty,
        unitPrice,
        lineTotal: qty * unitPrice,
        unitCost: product.cost > 0 ? product.cost : undefined,
      };
    });
    cursor += plan.lines;

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal > 50_000 ? 0 : 1895;
    const tax = Math.round((subtotal + shipping) * rate);

    const createdAt = daysAgo(plan.createdDaysAgo);
    const timeline = [{ status: 'draft', at: createdAt, note: 'Quote created.' }];
    if (plan.status !== 'draft') {
      timeline.push({ status: 'sent', at: createdAt, note: 'Sent to client.' });
    }
    if (plan.status === 'accepted') {
      timeline.push({ status: 'accepted', at: daysAgo(plan.createdDaysAgo - 2), note: 'Client accepted.' });
    }
    if (plan.status === 'rejected') {
      timeline.push({ status: 'rejected', at: daysAgo(plan.createdDaysAgo - 5), note: 'Client declined.' });
    }

    return {
      quoteNumber: `WQ-${year}-${String(sequence++).padStart(5, '0')}`,
      user: user._id,
      source: 'admin',
      status: plan.status,
      items,
      subtotal,
      shipping,
      tax,
      total: subtotal + shipping + tax,
      validUntil: plan.expiresIn >= 0 ? daysAhead(plan.expiresIn) : daysAgo(-plan.expiresIn),
      notes: plan.notes || undefined,
      timeline,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

/**
 * Five returns across the ladder, including one past the SLA.
 *
 * `daysOpen` drives the Age column: the `requested` row at 19 days is the one
 * that has to render in the danger token against a 14-day SLA, and the resolved
 * rows stop ageing at the moment they closed.
 */
const RMA_PLANS = [
  { lines: 1, status: 'requested', daysOpen: 3, reason: 'Screen arrived with a cracked digitiser.' },
  // Open far longer than the SLA allows - the row the Age column exists for.
  { lines: 2, status: 'approved', daysOpen: 19, reason: 'Two batteries will not hold a charge.' },
  { lines: 1, status: 'in_transit', daysOpen: 6, reason: 'Wrong part sent - charging port does not fit.' },
  {
    lines: 2,
    status: 'inspecting',
    daysOpen: 4,
    reason: 'Customer reports intermittent touch response.',
    conditions: ['Touch layer delaminated', 'No fault found on the workshop test'],
    dispositions: ['scrap', 'restock'],
  },
  {
    lines: 1,
    status: 'resolved',
    daysOpen: 26,
    closedDaysAgo: 21,
    reason: 'Dead on arrival.',
    conditions: ['Confirmed dead - no backlight'],
    dispositions: ['scrap'],
    resolution: 'refund',
  },
];

/**
 * `orders` are the seeded orders to return against. Lines are taken from each
 * order's own items, so a return can never name a part that was not sold
 * which is exactly the rule `rmaService.createRma` enforces.
 */
function buildRmas({ orders, year = new Date().getFullYear() }) {
  const usable = orders.filter((order) => (order.items ?? []).length > 0);
  if (!usable.length) return [];

  let sequence = 1;

  return RMA_PLANS.flatMap((plan, index) => {
    const order = usable[index % usable.length];
    const sourceLines = (order.items ?? []).slice(0, plan.lines);
    if (!sourceLines.length) return [];

    const createdAt = daysAgo(plan.daysOpen);
    const closedAt = plan.closedDaysAgo ? daysAgo(plan.closedDaysAgo) : null;

    const items = sourceLines.map((line, i) => ({
      product: line.product,
      sku: line.sku,
      name: line.name,
      // Never more than were sold - the same cap the service applies.
      qty: Math.min(1, line.qty),
      reason: plan.reason,
      condition: plan.conditions?.[i],
      disposition: plan.dispositions?.[i] ?? 'pending',
      unitPrice: line.unitPrice,
      // A resolved return that restocked has a timestamp; nothing else does.
      restockedAt: plan.status === 'resolved' && plan.dispositions?.[i] === 'restock' ? closedAt : undefined,
    }));

    const timeline = [{ status: 'requested', at: createdAt, note: 'Return requested.' }];
    const ladder = ['approved', 'in_transit', 'received', 'inspecting', 'resolved'];
    const reached = ladder.indexOf(plan.status);
    for (let i = 0; i <= reached; i += 1) {
      timeline.push({
        status: ladder[i],
        at: closedAt ?? daysAgo(Math.max(0, plan.daysOpen - (i + 1) * 2)),
        note: null,
      });
    }

    const refundAmount =
      plan.resolution === 'refund'
        ? items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0)
        : 0;

    return [
      {
        rmaNumber: `RMA-${year}-${String(sequence++).padStart(5, '0')}`,
        user: order.user,
        order: order._id,
        orderNumber: order.orderNumber,
        status: plan.status,
        items,
        reason: plan.reason,
        resolution: plan.resolution ?? 'pending',
        refundAmount,
        inspectionNotes: plan.conditions ? plan.conditions.join('. ') + '.' : undefined,
        timeline,
        createdAt,
        // Age stops at close, and it is `updatedAt` the shaper reads to know
        // when that was.
        updatedAt: closedAt ?? createdAt,
      },
    ];
  });
}

/**
 * Web quotes - the storefront's contact form, before anybody has priced it.
 *
 * These are enquiries, not quotes: the Web Quote screen is the queue a
 * staff member works *from* to raise a real one, which is why it sits under Quotes
 * in the nav. Spread across all three statuses and all five topics so the
 * screen's filters have something to separate, and deliberately mixed between
 * signed-in accounts and strangers - an enquiry from someone with no account is
 * the common case and the one the screen must not assume away.
 */
const WEB_QUOTE_PLANS = [
  {
    name: 'Nadia Fontaine',
    business: 'Fontaine Mobile',
    email: 'nadia@fontainemobile.example',
    phone: '+1 5145550171',
    topic: 'stock',
    daysAgo: 0,
    status: 'new',
    message:
      'Do you carry OEM iPhone 14 Pro panels in volume? We fit roughly forty a month across two shops and would want a standing order.',
  },
  {
    name: 'Terrence Bell',
    business: 'Bell Device Repair',
    email: 'terrence@belldevice.example',
    phone: '+1 9055550188',
    topic: 'account',
    daysAgo: 1,
    status: 'new',
    message:
      'Applied for a wholesale account last week and have not heard back. Happy to send incorporation papers again if they did not arrive.',
  },
  {
    name: 'Grace Okonjo',
    email: 'grace.okonjo@example.ca',
    phone: '+1 6135550124',
    topic: 'warranty',
    daysAgo: 2,
    status: 'new',
    message:
      'A battery we fitted in March has started swelling. It is within your ninety days - what do you need from us to process it?',
  },
  {
    name: 'Samuel Ortega',
    business: 'Northline Cellular',
    email: 'sam@northlinecellular.example',
    phone: '+1 7805550196',
    topic: 'stock',
    daysAgo: 4,
    status: 'read',
    message:
      'Looking for Pixel 8 Pro charging port flexes, fifty units. What is the lead time if they are not on the shelf?',
  },
  {
    name: 'Imani Clarke',
    email: 'imani.clarke@example.ca',
    topic: 'order',
    daysAgo: 6,
    status: 'read',
    message:
      'My last order arrived one screen short. The packing slip lists six, the box had five.',
  },
  {
    name: 'Victor Aubry',
    business: 'Aubry Telecom',
    email: 'victor@aubrytelecom.example',
    phone: '+1 4185550109',
    topic: 'other',
    daysAgo: 11,
    status: 'read',
    message:
      'Do you offer board-level repair as a subcontract? We get micro-soldering work we cannot take on ourselves.',
  },
  {
    name: 'Rachel Mbeki',
    business: 'Coastline Phone Clinic',
    email: 'rachel@coastlineclinic.example',
    phone: '+1 2505550115',
    topic: 'stock',
    daysAgo: 19,
    status: 'closed',
    message:
      'Quoted on a hundred Samsung A54 assemblies - thank you, we have gone ahead with the order.',
  },
  {
    name: 'Devon Wray',
    email: 'devon.wray@example.ca',
    topic: 'warranty',
    daysAgo: 27,
    status: 'closed',
    message: 'Charging port replaced in January has failed again. Resolved at the counter.',
  },
];

/**
 * `users` are the seeded accounts. An enquiry whose email matches one is linked
 * to it, so the screen can show the account context the model keeps a `user`
 * field for; the rest stay unattached, which is what a stranger's enquiry is.
 */
function buildWebQuotes({ users = [] } = {}) {
  const byEmail = new Map(users.map((user) => [user.email, user._id]));

  return WEB_QUOTE_PLANS.map((plan) => {
    const at = daysAgo(plan.daysAgo);

    return {
      name: plan.name,
      business: plan.business,
      email: plan.email,
      phone: plan.phone,
      topic: plan.topic,
      message: plan.message,
      user: byEmail.get(plan.email) ?? null,
      status: plan.status,
      createdAt: at,
      updatedAt: at,
    };
  });
}

export { daysAgo, daysAhead, buildQuotes, buildRmas, buildWebQuotes };
