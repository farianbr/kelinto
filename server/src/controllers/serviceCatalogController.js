import { asyncHandler } from '../utils/ApiError.js';
import * as serviceCatalogService from '../services/serviceCatalogService.js';
import auditService from '../services/auditService.js';
import '../models/Service.js';
import '../models/ServiceQuote.js';

/**
 * The repair service catalogue (Sales § Services).
 *
 * Thin, like every controller here. The rule worth not routing around lives in
 * the service: a service that has been quoted or ticketed is deactivated rather
 * than deleted, so the reports that group historical work by service keep
 * working.
 */

const listServices = asyncHandler(async (req, res) => {
  res.json(
    await serviceCatalogService.listServices({ ...req.query, business: req.businessScope }),
  );
});

const getService = asyncHandler(async (req, res) => {
  res.json(await serviceCatalogService.getService(req.params.id));
});

const createService = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(
      await serviceCatalogService.createService(req.body, req.user._id, req.businessScope),
    );
});

const updateService = asyncHandler(async (req, res) => {
  res.json(await serviceCatalogService.updateService(req.params.id, req.body));
});

/**
 * Deleting is only ever possible for a service nothing points at, so there is
 * no history to lose - but it is still the price list changing, and the name is
 * recorded because after this call nothing else holds it.
 */
const deleteService = asyncHandler(async (req, res) => {
  const result = await serviceCatalogService.deleteService(req.params.id);

  await auditService.record({
    req,
    action: 'service.delete',
    entity: { kind: 'service', id: req.params.id, label: result.name ?? '' },
    description: `Deleted service "${result.name ?? req.params.id}" from the price list.`,
  });

  res.json(result);
});

const importServices = asyncHandler(async (req, res) => {
  const result = await serviceCatalogService.importServices(
    req.body.text,
    req.user._id,
    req.businessScope,
  );

  await auditService.recordChange({
    req,
    action: 'service.import',
    entity: { kind: 'service', id: 'import', label: 'Service price list' },
    before: null,
    after: { added: result.added, updated: result.updated, skipped: result.skipped },
    description: `Imported services: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`,
  });

  res.json(result);
});

/** The website's services page. Open to guests; the price is gated in the service. */
const publicList = asyncHandler(async (req, res) => {
  res.json(
    await serviceCatalogService.publicList(req.user, {
      ...req.query,
      business: req.businessScope,
    }),
  );
});

/** One service's page on the website. Same gate as the list. */
const publicGet = asyncHandler(async (req, res) => {
  res.json(await serviceCatalogService.publicGet(req.user, req.params.slug, { business: req.businessScope }));
});

export { publicGet, publicList, listServices, getService, createService, updateService, deleteService, importServices };
export default { publicGet, publicList, listServices, getService, createService, updateService, deleteService, importServices };
