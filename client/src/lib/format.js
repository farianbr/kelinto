/**
 * View-layer formatters. Money is stored and transported as integer cents
 * everywhere else in the system - this is the only place it becomes a string.
 */

import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatClockTime,
  formatIsoDate,
  formatDateRange,
  toIsoDate,
} from '@shared/dates';

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
});

const CAD_COMPACT = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

/** 12995 -> "$129.95" */
export function money(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '-';
  return CAD.format(cents / 100);
}

/** 1299500 -> "$12,995" - for dashboard tiles where cents are noise. */
export function moneyCompact(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '-';
  return CAD_COMPACT.format(cents / 100);
}

/**
 * 1299500 -> "$13K" - for chart axis ticks, where `moneyCompact`'s "$12,995"
 * is wide enough to force the plot area narrow on a phone.
 *
 * Not `Intl`'s `notation: 'compact'`: it renders 1500 as "1.5K" and 999 as
 * "999", so a tick column mixes widths and decimal places down its length. An
 * axis is a ruler - every mark on it should read the same shape.
 */
export function moneyAxis(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '-';

  const dollars = cents / 100;
  const magnitude = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';

  if (magnitude >= 1_000_000) return `${sign}$${Math.round(magnitude / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${sign}$${Math.round(magnitude / 1_000)}K`;
  // Rounding to whole dollars below $10 makes a sub-dollar step print the same
  // label twice - an axis reading `$0 $1 $1 $2 $2 $3`. Keep the cents on a
  // small scale, and drop them again once they are noise.
  if (magnitude > 0 && magnitude < 10) return `${sign}$${dollars.toFixed(2).replace('-', '')}`;
  return `${sign}$${Math.round(magnitude)}`;
}

/**
 * The date formats live in `shared/dates.js` so the invoice PDF the server
 * renders and the table cell the client renders cannot drift apart. Re-exported
 * under the short names the app already imports from here.
 */
export {
  formatDate as date,
  formatDateShort as dateShort,
  formatDateTime as dateTime,
  formatClockTime as clockTime,
  formatIsoDate as isoDate,
  formatDateRange as dateRange,
  toIsoDate,
};

/** "in 6 days" / "3 days ago" / "today" */
export function relativeDays(value) {
  if (!value) return '-';
  const days = Math.round((new Date(value) - new Date()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/**
 * "just now" / "4m ago" / "3h ago" / "2d ago" / "14-Mar" - for the notification
 * bell (§7.3), which needs finer grain than `relativeDays`.
 *
 * A notification from eleven minutes ago rendered as "today" tells the staff member
 * nothing about whether they have already seen it. Past a week the relative
 * form stops helping and it falls back to a date.
 */
export function relativeTime(value) {
  if (!value) return '';
  const seconds = Math.round((new Date() - new Date(value)) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
  return formatDateShort(value);
}

/** 1240 -> "1,240" */
export function count(n) {
  if (n === null || n === undefined) return '0';
  return new Intl.NumberFormat('en-CA').format(n);
}

/** "samsung-s23-ultra" -> "Samsung S23 Ultra" (fallback only; prefer server-supplied names). */
export function titleize(slug = '') {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * A product name with its part type stripped off the end.
 *
 * `name` is stored as "<model> <part type>" ("OnePlus 10 Pro Earpiece Speaker")
 * because an order line, an invoice, a search result and an export all need the
 * part type inside the one string they print. The catalogue surfaces do not: the
 * card, the PDP and the cart line already show `partTypeLabel` in the eyebrow
 * directly above the name, so the full name repeated it a word later.
 *
 * The suffix is only removed when it really is a suffix and something is left
 * over - a bad label, a name that never carried it, or a product whose whole
 * name IS the part type all fall through to the untouched name.
 */
export function productTitle(name = '', partTypeLabel = '') {
  const label = partTypeLabel.trim();
  if (!label) return name;

  const trimmed = name.trim();
  if (trimmed.length <= label.length) return name;
  if (trimmed.slice(-label.length).toLowerCase() !== label.toLowerCase()) return name;

  const head = trimmed.slice(0, -label.length).trim();
  return head || name;
}
