import { chromium } from 'playwright';
const OUT = process.env.TEMP;
const BASE = 'http://localhost:5173';
const BIZ = '6aa8d751154fb8a57897c966';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
await p.request.post(`${BASE}/api/auth/login`, { data: { email: 'admin@cellvix.ca', password: 'Cellvix123!' } });

await p.goto(`${BASE}/admin/tickets/6aa8d766154fb8a57897d53b?business=${BIZ}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/b-detail.png` });

// open the status picker
await p.getByLabel(/Set status to/i).click().catch(async () => {
  await p.locator('button[aria-haspopup="listbox"]').first().click();
});
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/c-detail-open.png` });
await b.close();
