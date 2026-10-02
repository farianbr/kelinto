/**
 * The eight components a counter checks at drop-off, and the answers each one
 * takes.
 *
 * ## Each part has its own answers (client ruling, 2026-10-02)
 *
 * The grid used to offer the same four grades on every row (working, faulty,
 * not present, untested). That is not how a technician describes a phone: a
 * screen is cracked with touch still working, or dark with touch gone, and a
 * charging port is dirty far more often than it is broken. So each part
 * carries the vocabulary the client's own intake sheet uses, and "Good" is the
 * last answer on every one of them.
 *
 * Read by the ticket and buyback forms, the ticket and buyback detail pages,
 * the kiosk's eight condition screens, the Zod schemas and the Mongoose
 * models. One list, so the tablet cannot offer an answer the server refuses.
 *
 * ## The old grades still read
 *
 * Tickets, buybacks and pre-owned phones written before this change hold
 * `working`, `faulty`, `not_present` or `untested`. They stay valid in storage
 * and keep their labels, so a closed ticket still prints what was recorded; no
 * form offers them any more.
 */

const CAMERA_OR_SPEAKER = [
  { value: 'not_working', label: 'Not Working', detail: 'It does not work' },
  { value: 'not_checkable', label: 'Not Possible to Check', detail: "I can't tell" },
  { value: 'good', label: 'Good', detail: 'No problem with it' },
];

export const CONDITION_PARTS = [
  {
    key: 'screen',
    label: 'Screen',
    options: [
      { value: 'broken_touch_working', label: 'Broken Touch Working', detail: 'Cracked, but touch still works' },
      { value: 'broken_no_touch', label: 'Broken No Touch', detail: 'Cracked, and touch does not work' },
      { value: 'good_no_touch', label: 'Good No Touch', detail: 'Not cracked, but touch does not work' },
      { value: 'good', label: 'Good', detail: 'No problem with it' },
    ],
  },
  {
    key: 'battery',
    label: 'Battery',
    options: [
      { value: 'no_charging', label: 'No Charging', detail: 'It will not charge' },
      { value: 'good', label: 'Good', detail: 'No problem with it' },
    ],
  },
  {
    key: 'chargingPort',
    label: 'Charging Port',
    options: [
      { value: 'dirty', label: 'Dirty', detail: 'Lint or dirt inside it' },
      { value: 'good', label: 'Good', detail: 'No problem with it' },
    ],
  },
  {
    key: 'backGlass',
    label: 'Back Glass',
    options: [
      { value: 'broken', label: 'Broken', detail: 'Cracked or shattered' },
      { value: 'scratch', label: 'Scratch', detail: 'Scratched, not cracked' },
      { value: 'good', label: 'Good', detail: 'No problem with it' },
    ],
  },
  { key: 'frontCamera', label: 'Front Camera', options: CAMERA_OR_SPEAKER },
  { key: 'backCamera', label: 'Back Camera', options: CAMERA_OR_SPEAKER },
  { key: 'loudSpeaker', label: 'Loud Speaker', options: CAMERA_OR_SPEAKER },
  { key: 'earSpeaker', label: 'Ear Speaker', options: CAMERA_OR_SPEAKER },
];

export const CONDITION_PART_KEYS = CONDITION_PARTS.map((part) => part.key);

/** Grades written before 2026-10-02. Readable, never offered. */
export const LEGACY_CONDITION_GRADES = [
  { value: 'working', label: 'Working' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'not_present', label: 'Not present' },
  { value: 'untested', label: 'Untested' },
];

/** Every value storage accepts: today's answers plus the legacy grades. */
export const CONDITION_VALUES = [
  ...new Set([
    ...CONDITION_PARTS.flatMap((part) => part.options.map((option) => option.value)),
    ...LEGACY_CONDITION_GRADES.map((grade) => grade.value),
  ]),
];

const PART_BY_KEY = Object.fromEntries(CONDITION_PARTS.map((part) => [part.key, part]));
const LEGACY_LABELS = Object.fromEntries(LEGACY_CONDITION_GRADES.map((grade) => [grade.value, grade.label]));

/** The answers one part offers, for a select or a kiosk screen. */
export function conditionOptionsFor(partKey) {
  return PART_BY_KEY[partKey]?.options ?? [];
}

/** The label for a stored answer, in that part's own words. */
export function conditionLabel(partKey, value) {
  if (!value) return '';
  const own = PART_BY_KEY[partKey]?.options.find((option) => option.value === value);
  return own?.label ?? LEGACY_LABELS[value] ?? value;
}

/** True for the answer that needs nothing done: `good`, or the legacy `working`. */
export function isConditionGood(value) {
  return value === 'good' || value === 'working';
}

/** True when a part can hold this value: one of its own answers, or a legacy grade. */
export function isConditionValue(partKey, value) {
  if (!PART_BY_KEY[partKey]) return false;
  return conditionOptionsFor(partKey).some((option) => option.value === value) || value in LEGACY_LABELS;
}

/**
 * The parts that need attention, as one line: "Screen broken no touch · Battery
 * no charging". Empty when nothing was answered or everything is good; callers
 * word those two cases themselves.
 */
export function conditionProblems(condition = {}) {
  return CONDITION_PARTS.filter((part) => condition?.[part.key] && !isConditionGood(condition[part.key]))
    .map((part) => `${part.label}: ${conditionLabel(part.key, condition[part.key]).toLowerCase()}`)
    .join(' · ');
}

/** True when at least one part was answered. */
export function conditionAnswered(condition = {}) {
  return CONDITION_PARTS.some((part) => condition?.[part.key]);
}
