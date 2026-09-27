import mongoose from 'mongoose';

/**
 * Session ids and one-time tokens that no longer count (control plane).
 *
 * ## Why a session needs a server-side list at all
 *
 * A session is a signed JWT in an httpOnly cookie. Signing out used to clear
 * the cookie and nothing else, so a copy of the token taken before sign-out
 * (a shared machine, a synced browser profile, a leaked log) stayed valid for
 * the rest of its 7- or 90-day life. Every session now carries a random `sid`,
 * and signing out writes that `sid` here; `authenticate` refuses any token whose
 * `sid`, or whose `parent`, is listed.
 *
 * `parent` is what makes signing out of the ERP also sign the same person out
 * of the website they opened from it: the website session minted by the
 * ERP-to-website handoff names the ERP session as its parent.
 *
 * ## One-time tokens use the same list
 *
 * A handoff link is spent by inserting its `jti` here. `_id` is unique, so two
 * claims of one link race on the insert and exactly one wins, with no
 * read-then-write window between them.
 *
 * ## Size
 *
 * A row lives only as long as the token it names could have: `expiresAt` is
 * that token's own expiry, and the TTL index deletes the row after it. A
 * revoked token that has expired is refused by its signature anyway.
 */
const revokedTokenSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    kind: { type: String, enum: ['session', 'handoff'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RevokedToken = mongoose.model('RevokedToken', revokedTokenSchema);

export { RevokedToken };
export default RevokedToken;
