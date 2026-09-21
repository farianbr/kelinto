import { chromium } from 'playwright';
const OUT = process.env.TEMP;
const BASE = 'http://localhost:5173';
const BIZ = '6aa8d751154fb8a57897c966';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
await p.request.post(`${BASE}/api/auth/login`, { data: { email: 'admin@cellvix.ca', password: 'Cellvix123!' } });

// 1. list page, status pill open
await p.goto(`${BASE}/admin/tickets?business=${BIZ}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.getByRole('button', { name: /Status for TKT-2026-00008/i }).click();
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/a-list-open.png` });

await b.close();
