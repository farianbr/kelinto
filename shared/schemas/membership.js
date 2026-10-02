import { z } from 'zod';

/**
 * Membership plans (client ruling, 2026-10-01).
 *
 * A plan is a paid tier a customer subscribes to: Silver, Gold or Platinum,
 * with a yearly price and a list of benefits. The tiers are the same three
 * values `User.tier` already holds, so a customer staff move onto Gold is on
 * the Gold plan and the website marks it as theirs. Standard is the tier every
 * account starts on and is not sold.
 *
 * ## The benefits are a matrix, edited once
 *
 * Every benefit is one ROW with a value per plan, grouped under section
 * headings, exactly as the comparison table draws it. The plan cards are not a
 * second list: they show the rows marked `highlight`, read from the same
 * matrix, so a benefit changed in the ERP changes on the card and in the table
 * together and the two can never disagree.
 *
 * A cell is `yes` (a tick), `no` (a cross) or `text` ("Up to $1,000", "2nd
 * time 20% off"). A row with `source: 'warranty'` has no cells of its own: the
 * server fills it from Sale Settings (base warranty plus the tier's bonus),
 * which is what a repair actually carries, so the page cannot promise one
 * warranty while the invoice prints another.
 */

export const PLAN_TIERS = ['silver', 'gold', 'platinum'];
export const PLAN_INTERVALS = [
  { value: 'year', label: 'per year' },
  { value: 'month', label: 'per month' },
];
export const CELL_KINDS = [
  { value: 'yes', label: 'Included' },
  { value: 'no', label: 'Not included' },
  { value: 'text', label: 'Text' },
];

const yes = { kind: 'yes', text: '' };
const no = { kind: 'no', text: '' };
const text = (value) => ({ kind: 'text', text: value });
const same = (cell) => ({ silver: cell, gold: cell, platinum: cell });
const each = (silver, gold, platinum) => ({ silver, gold, platinum });

/** The client's figures, as supplied on 2026-10-01. Every one is editable in the ERP. */
export const DEFAULT_MEMBERSHIP = {
  plans: [
    {
      tier: 'silver',
      name: 'Silver',
      priceCents: 4900,
      interval: 'year',
      tagline: 'Everyday protection and savings for your device essentials.',
      isFeatured: false,
      isActive: true,
    },
    {
      tier: 'gold',
      name: 'Gold',
      priceCents: 9900,
      interval: 'year',
      tagline: 'Serious repair savings, faster turnaround, no waiting around.',
      isFeatured: true,
      isActive: true,
    },
    {
      tier: 'platinum',
      name: 'Platinum',
      priceCents: 14900,
      interval: 'year',
      tagline: 'Full-service coverage for you, your home and one more device.',
      isFeatured: false,
      isActive: true,
    },
  ],
  sections: [
    {
      title: 'Protection & savings',
      rows: [
        {
          label: 'Total valued protection',
          highlight: true,
          cells: each(text('Up to $1,000'), text('Up to $2,000'), text('Up to $3,000')),
        },
        { label: 'UV screen protector', cells: same(text('$1.90 (save $27.10)')) },
        { label: 'Premium phone case', cells: same(text('$9.90 (save $19.10)')) },
        { label: 'High-speed data cable', cells: same(text('$9.90 (save $19.10)')) },
        { label: 'Free servicing', cells: same(yes) },
        { label: 'Free diagnosis', cells: same(yes) },
        {
          label: 'Plan usage',
          highlight: true,
          cells: each(text('12 times'), text('24 times'), text('36 times')),
        },
      ],
    },
    {
      title: 'Repair benefits',
      rows: [
        { label: 'Instant screen-repair discount', highlight: true, cells: each(no, yes, yes) },
        {
          label: 'Repeat-repair discount',
          highlight: true,
          cells: each(no, text('2nd time 20% off\n3rd time 30% off'), text('2nd time 20% off\n3rd time 30% off')),
        },
        {
          label: 'Device diagnosis wait time',
          cells: each(text('Standard'), text('No wait'), text('No wait')),
        },
        {
          label: 'Retention window',
          cells: each(text('30 days'), text('60 days'), text('90 days')),
        },
      ],
    },
    {
      title: 'Home & family',
      rows: [
        { label: 'Doorstep fix', highlight: true, cells: each(no, no, yes) },
        { label: 'Devices covered', highlight: true, cells: each(text('1'), text('2'), text('3')) },
        { label: 'Family members included', cells: each(text('0'), text('1'), text('2')) },
        { label: 'Warranty coverage', highlight: true, source: 'warranty', cells: {} },
      ],
    },
  ],
};

const cellSchema = z.object({
  kind: z.enum(CELL_KINDS.map((kind) => kind.value)),
  text: z.string().trim().max(120, 'Keep a value to 120 characters.').default(''),
});

const rowSchema = z.object({
  label: z.string().trim().min(1, 'Name the benefit.').max(80, 'Keep a benefit name to 80 characters.'),
  highlight: z.boolean().default(false),
  source: z.enum(['', 'warranty']).default(''),
  cells: z.record(z.enum(PLAN_TIERS), cellSchema).default({}),
});

const sectionSchema = z.object({
  title: z.string().trim().min(1, 'Name the section.').max(60),
  rows: z.array(rowSchema).max(30, 'Keep a section to 30 benefits.'),
});

const planSchema = z.object({
  tier: z.enum(PLAN_TIERS),
  name: z.string().trim().min(1, 'Name the plan.').max(40),
  // Dollars on the form, cents in the store, like every other admin price.
  priceDollars: z.coerce
    .number({ invalid_type_error: 'Enter a price.' })
    .min(0, 'A price cannot be negative.')
    .max(100000, 'That price looks wrong.'),
  interval: z.enum(PLAN_INTERVALS.map((interval) => interval.value)),
  tagline: z.string().trim().max(160, 'Keep the line under the name to 160 characters.').default(''),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const membershipSettingsSchema = z
  .object({
    plans: z.array(planSchema).min(1, 'Keep at least one plan.').max(PLAN_TIERS.length),
    sections: z.array(sectionSchema).max(8, 'Keep the table to eight sections.'),
    // The same field Sale Settings edits; written from here too so the plan
    // and its warranty are set on one screen.
    warrantyBonusByTier: z
      .record(z.enum(PLAN_TIERS), z.coerce.number().int().min(0, 'A bonus cannot be negative.').max(3650))
      .optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.plans.forEach((plan, index) => {
      if (seen.has(plan.tier)) {
        ctx.addIssue({ code: 'custom', path: ['plans', index, 'tier'], message: 'Each tier has one plan.' });
      }
      seen.add(plan.tier);
    });
    // One plan carries the "most popular" weight; two would cancel each other out.
    if (value.plans.filter((plan) => plan.isFeatured).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['plans'], message: 'Feature one plan at most.' });
    }
  });

export const membershipRequestSchema = z.object({
  tier: z.enum(PLAN_TIERS),
});
