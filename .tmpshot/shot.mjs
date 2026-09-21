import { chromium } from 'playwright';
const OUT = process.env.TEMP;
const BASE = 'http://localhost:5173';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });

const r = await p.request.post(`${BASE}/api/auth/login`, {
  data: { email: 'admin@cellvix.ca', password: 'Cellvix123!' },
});
if (!r.ok()) throw new Error('login ' + r.status());

// switch to CellShoppe
await p.goto(`${BASE}/admin/tickets`, { waitUntil: 'networkidle' });
await p.evaluate(() => {
  try { localStorage.setItem('cellvix.business', JSON.stringify('6aa8d751154fb8a57897c966')); } catch {}
});
await p.goto(`${BASE}/admin/tickets?business=6aa8d751154fb8a57897c966`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
console.log('tickets url:', p.url());
await p.screenshot({ path: `${OUT}/t-list.png`, fullPage: false });
await b.close();
