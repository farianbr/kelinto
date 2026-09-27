import mongoose from 'mongoose';

/**
 * An uploaded file no record points at yet (control plane).
 *
 * A file goes to R2 the moment it is chosen, so the person can see it before
 * saving. Until the form is saved, the file belongs to nothing - and a form
 * that is cancelled, closed or abandoned would otherwise leave it in the bucket
 * for ever, paid for and unreachable.
 *
 * So every upload writes a row here. Saving the record that uses it deletes the
 * row (`storageService.claim`). Discarding the form deletes the file and the row
 * at once (`storageService.discard`). Anything still here after a few hours was
 * abandoned without either - a closed tab, a crash - and the sweeper deletes the
 * file (`storageService.sweepAbandoned`).
 *
 * `_id` is the object key, which is also what makes a claim and a discard safe:
 * only a key still listed here can be discarded, so a file a saved record uses
 * can never be deleted by a stale "discard" from another tab.
 */
const pendingUploadSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

const PendingUpload = mongoose.model('PendingUpload', pendingUploadSchema);

export { PendingUpload };
export default PendingUpload;
