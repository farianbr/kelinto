import { Link as LinkIcon, Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';

/**
 * The glyph and label for a social network, by name.
 *
 * **A registry, not the list to render.** Which networks appear is the
 * business's own answer - `Settings.business.social` holds one row per profile
 * it has - so this only answers "what does that one look like". Both the footer
 * and the mobile drawer draw the same row set and used to carry a copy of this
 * list each, keyed to the hardcoded `BUSINESS_INFO.social` object.
 *
 * `socialIcon` never returns nothing: a business on a network with no glyph
 * here still gets its chip, drawn with a generic link icon and labelled by the
 * network's own name. Dropping the row instead would be a profile the owner
 * entered and cannot see, which is worse than an unfamiliar glyph.
 */
const SOCIAL_ICONS = {
  facebook: { icon: Facebook, label: 'Facebook' },
  instagram: { icon: Instagram, label: 'Instagram' },
  linkedin: { icon: Linkedin, label: 'LinkedIn' },
  youtube: { icon: Youtube, label: 'YouTube' },
};

/** One network's glyph and label, falling back to a generic link. */
export function socialIcon(network) {
  return SOCIAL_ICONS[network] ?? { icon: LinkIcon, label: network };
}

export { SOCIAL_ICONS };
export default socialIcon;
