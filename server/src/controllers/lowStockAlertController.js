import { asyncHandler } from '../utils/ApiError.js';
import { sendLowStockAlert } from '../services/lowStockAlertService.js';

/**
 * Send the low-stock alert now.
 *
 * The same entry point a scheduled job would call, exposed so a staff member
 * can send one from Email Settings without waiting a day - and so the feature
 * is testable at all before a cron exists. `force` skips the once-a-day guard,
 * because a person pressing the button has asked for it explicitly.
 */
const run = asyncHandler(async (req, res) => {
  res.json(await sendLowStockAlert({ force: req.body?.force === true }));
});

export { run };
export default { run };
