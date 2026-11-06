import { isLocalDev } from '../../lib/devEnv';
import type { SimBranch, SimChat, SimOpened, SimulationData, SimWaiting } from './simulationTypes';

// LOCAL DEV ONLY — `?demo=busy` on the simulation page. Replaces the company's shops with
// twelve made-up busy ones (many cars, many people, crowds outside, files left from earlier
// days, chats) so the page's speed can be tried on a real iPad: DEV has almost no live
// traffic. Never active outside the dev hosts in devEnv.ts. Numbers are fixed per shop, so
// the picture doesn't reshuffle on every 15 s answer.

export const simulationDemoOn = () => isLocalDev() && new URLSearchParams(window.location.search).get('demo') === 'busy';

const SHOPS = 12;
// Per shop: [opened today, desk, approval, sign, pay, earlier-day files, chats]
const MIX: [number, number, number, number, number, number, number][] = [
  [6, 4, 12, 8, 3, 6, 5], [2, 1, 3, 1, 0, 0, 1], [4, 6, 30, 30, 10, 18, 14], [0, 0, 0, 0, 0, 0, 0],
  [5, 3, 8, 4, 2, 2, 3], [3, 2, 2, 2, 1, 9, 0], [7, 4, 10, 6, 2, 0, 6], [1, 0, 1, 0, 0, 4, 2],
  [3, 4, 6, 5, 2, 1, 2], [0, 1, 0, 1, 0, 12, 0], [4, 3, 9, 9, 4, 3, 8], [2, 2, 4, 3, 1, 0, 1],
];
const STATES: [string, number][] = [['DRAFT', 1], ['PENDING_APPROVAL', 2], ['PENDING_SIGN', 3], ['PENDING_PAYMENT', 4]];

/** Minutes since midnight (Thai time) of the answer, so "today" ages stay today. */
function minutesToday(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
}

export function busyDemo(d: SimulationData): SimulationData {
  const template = d.branches[0];
  if (!template) return d;
  const today = Math.max(30, minutesToday(d.generated_at) - 1);
  const waiting: SimWaiting[] = [];
  const chat: SimChat[] = [];
  let id = 990000;
  const branches: SimBranch[] = MIX.slice(0, SHOPS).map((m, i) => {
    const bid = 99000 + i;
    const opened: SimOpened[] = Array.from({ length: m[0] }, (_, k) => ({
      code: `CT-DEMO-${i}-${k}`, asset: `AT-DEMO-${i}-${k}`, product: 'Apple iPhone 16 128GB', grade: k % 3 ? 'NEW' : 'USED_A',
      financed: 18000, commission: 500, future: 30000, profit: 4000, investment: 18500, months: 12,
      down: 3000, device_price: 21000, down_pct: 14.3, installment: 2300, serial: `DEMO${i}${k}`, sale_price: 21000, uplift: 0,
    }));
    STATES.forEach(([state], s) => {
      for (let k = 0; k < m[1 + s]; k++) {
        waiting.push({ id: id++, branch_id: bid, code: `CT-DEMO-W${id}`, state, age_min: Math.min(today, 3 + k * 4 + s * 7), months: 12, product: 'Apple iPhone 16 128GB', asset: '' });
      }
    });
    for (let k = 0; k < m[5]; k++) {
      waiting.push({ id: id++, branch_id: bid, code: `CT-DEMO-S${id}`, state: k % 3 ? 'PENDING_SIGN' : 'PENDING_APPROVAL', age_min: today + 600 + k * 1440, months: 12, product: 'Apple iPhone 15 128GB', asset: '' });
    }
    for (let k = 0; k < m[6]; k++) {
      chat.push({ id: id++, branch_id: bid, code: `CT-DEMO-C${id}`, unread: (k % 4) + 1, age_min: Math.min(today, 10 + k * 13) });
    }
    return {
      ...template,
      id: bid, code: `DEMO_${i + 1}`, name: `DEMO สาขา ${i + 1}`, type: i % 4 === 3 ? 'DEAL_PARTNER' : 'INTERNAL',
      day_closed: false, opened, opened_today: opened.length,
      cash: 5000 + i * 2500, transfer: 8000 + i * 1800, wallet: 1200 * (i % 3), other: 0, received: 0,
      financed: opened.length * 18000, commission: opened.length * 500, down: opened.length * 3000, device_price: opened.length * 21000,
      down_pct: opened.length ? 14.3 : null, pending_payout: 4000 * (i % 3), payout: 3000 * (i % 2),
    };
  });
  return {
    ...d,
    branches,
    waiting,
    chat,
    can_see_chat: true,
    companies: d.companies.map(c => (c.id === d.company_id ? { ...c, branch_count: SHOPS, opened_today: branches.reduce((s, b) => s + b.opened.length, 0) } : c)),
  };
}
