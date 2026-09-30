import { asyncHandler } from '../utils/ApiError.js';
import * as kioskService from '../services/kioskService.js';
import auditService from '../services/auditService.js';
import { resolveFeaturesFor } from '../middleware/feature.js';
import { readKioskSession } from '../middleware/kioskAuth.js';
import { featureEnabled } from '../../../shared/schemas/features.js';
import '../models/Ticket.js';
import '../models/DeviceCatalog.js';

/**
 * Self-service check-in (Sales § Kiosk).
 *
 * Thin, like every controller here. The rules worth not routing around live in
 * the service: the PIN is compared against a hash and answers the same way
 * whether or not one is set, and a check-in writes a partial ticket flagged for
 * staff review rather than a complete one.
 *
 * **Nothing here reads `req.user`.** Nobody is signed in at a kiosk.
 */

/** What the lock and welcome screens need, before anybody has unlocked it. */
const getConfig = asyncHandler(async (req, res) => {
  // The business the host resolved to. It is what names the shop on screen and
  // what decides the colour the whole tablet is painted in.
  const config = await kioskService.getPublicConfig(req.businessScope);
  const features = req.features ?? (await resolveFeaturesFor(req));

  res.json({
    ...config,
    /**
     * Whether this tablet already holds a live kiosk session.
     *
     * The kiosk reloads itself: a customer who shopped on the website comes
     * back to `/kiosk` as a fresh page. Without this, every "Order again?"
     * would land on the staff PIN screen with the customer standing at it.
     */
    unlocked: Boolean(readKioskSession(req)),
    /**
     * The three doors on the welcome screen, each behind the feature that does
     * its work, so a business without a website is never offered "Buy parts".
     */
    modes: {
      repair: featureEnabled(features, 'sales.tickets'),
      sell: featureEnabled(features, 'sales.buyback'),
      buy:
        featureEnabled(features, 'storefront.public') &&
        featureEnabled(features, 'storefront.checkout'),
    },
  });
});

const unlock = asyncHandler(async (req, res) => {
  res.json(await kioskService.unlock(res, req.body));
});

const lock = asyncHandler(async (req, res) => {
  kioskService.clearSession(res);
  res.json({ locked: true });
});

/** The device tree the questions walk. Behind the session, like the check-in. */
const getDevices = asyncHandler(async (req, res) => {
  res.json(await kioskService.getDeviceOptions());
});

/** "Let's find your details". Answers masked, and never with the account. */
const lookup = asyncHandler(async (req, res) => {
  res.json(await kioskService.lookupCustomer(req.body, req.businessScope));
});

/**
 * "Buy parts": the website's sign-in and sign-up, from the tablet.
 *
 * Behind the kiosk session like everything else here, which is what makes the
 * approval inside them safe: only a tablet staff unlocked with the shop PIN can
 * reach the door that approves an account on the spot.
 */
const shopSignIn = asyncHandler(async (req, res) => {
  res.json(await kioskService.shopSignIn(req, res, req.body));
});

const shopSignUp = asyncHandler(async (req, res) => {
  res.status(201).json(await kioskService.shopSignUp(req, res, req.body));
});

const checkIn = asyncHandler(async (req, res) => {
  res.status(201).json(await kioskService.checkIn(req.body, req.businessScope));
});

/**
 * Setting the PIN is an admin action, not a kiosk one.
 *
 * Audited because it is a credential changing: somebody who can set the PIN can
 * unlock every tablet in the shop, and the record of who did it is the only
 * trace afterwards. **The PIN itself is never recorded**, here or anywhere.
 */
const setPin = asyncHandler(async (req, res) => {
  const result = await kioskService.setPin(req.body);

  await auditService.record({
    req,
    action: 'kiosk.pin',
    entity: { kind: 'settings', id: 'kiosk', label: 'Kiosk PIN' },
    description: 'Changed the kiosk PIN.',
  });

  res.json(result);
});

export { getConfig, unlock, lock, getDevices, lookup, shopSignIn, shopSignUp, checkIn, setPin };
export default { getConfig, unlock, lock, getDevices, lookup, shopSignIn, shopSignUp, checkIn, setPin };
