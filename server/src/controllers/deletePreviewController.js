import { asyncHandler } from '../utils/ApiError.js';
import deletePreviewService from '../services/deletePreviewService.js';

/**
 * What deleting one record would do (§3.0.1, applied before the confirm).
 *
 * Read-only and not audited: asking what would happen changes nothing, and a
 * log entry per hover over a delete button would bury the writes that matter.
 * The delete itself is audited, as it always was.
 */
const preview = asyncHandler(async (req, res) => {
  res.json(await deletePreviewService.preview(req.params.type, req.params.id));
});

export { preview };
export default { preview };
