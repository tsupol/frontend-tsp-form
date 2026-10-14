// Page path in → QR code that opens that page on a real iPad, already logged in.
//
//   node .claude/skills/ipad-test/qr.mjs /admin/contracts/new/98084
//   node .claude/skills/ipad-test/qr.mjs /admin/bills --user mcp_company_admin_b
//
// Picks the test user itself for contract pages (the branch manager of the
// contract's branch); anything else defaults to company_admin unless --user is
// given. The link goes through /dev-login on this machine's wifi address and
// carries ?debug=1, so the iPad's console lands in devlog.
//
// Writes screenshots/ipad-qr.svg (gitignored) and prints the URL + user.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';

const API = 'https://nnf.czynet.dev';
const PORT = 5173;
const LOOKUP_USER = 'mcp_holding_admin'; // sees every company — only used to read
const PASSWORD = 'Test123456';

const args = process.argv.slice(2);
const userFlag = args.indexOf('--user');
let user = userFlag >= 0 ? args[userFlag + 1] : null;

// Accepts "/admin/x", a full "https://localhost:5173/admin/x", or what Git Bash
// turns a leading-slash arg into ("C:/Program Files/Git/admin/x").
function toPath(raw) {
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) { const u = new URL(raw); return u.pathname + u.search; }
  const msys = raw.match(/^[A-Za-z]:[\\/].*?[\\/]Git(\/.*)$/);
  if (msys) return msys[1];
  return raw.startsWith('/') ? raw : null;
}
const pagePath = toPath(args.find((a, i) => !a.startsWith('--') && !(userFlag >= 0 && i === userFlag + 1)));

if (!pagePath) {
  console.error('Usage: node .claude/skills/ipad-test/qr.mjs <page path> [--user <username>]');
  process.exit(1);
}

// The wifi address the iPad can reach. Skip Hyper-V/WSL/VPN adapters — they
// are private-range too but the iPad has no route to them.
function lanIp() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|Tailscale|ZeroTier/i.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) found.push(a.address);
    }
  }
  return found.find((ip) => ip.startsWith('192.168.')) ?? found[0];
}

async function pickUser(p) {
  const m = p.match(/\/contracts\/(?:new\/)?(\d+)/);
  if (!m) return 'company_admin';

  const login = await fetch(`${API}/rpc/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ p_username: LOOKUP_USER, p_password: PASSWORD }),
  }).then((r) => r.json());
  const auth = { Authorization: `Bearer ${login.data.access_token}` };

  const [contract] = await fetch(`${API}/v_contracts?id=eq.${m[1]}&select=branch_id,branch_name`, { headers: auth }).then((r) => r.json());
  if (!contract) throw new Error(`Contract ${m[1]} not found`);

  const [manager] = await fetch(
    `${API}/v_users?branch_id=eq.${contract.branch_id}&username=like.mcp_branch_manager_*&select=username`,
    { headers: auth },
  ).then((r) => r.json());
  if (!manager) throw new Error(`No mcp_branch_manager_* test user on branch "${contract.branch_name}" — pass --user`);
  return manager.username;
}

const ip = lanIp();
if (!ip) {
  console.error('No wifi address found — is this machine on the network?');
  process.exit(1);
}
user ??= await pickUser(pagePath);

const url = `https://${ip}:${PORT}/dev-login?u=${encodeURIComponent(user)}&to=${encodeURIComponent(pagePath)}&debug=1`;

const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value: url, size: 320, marginSize: 4, bgColor: '#ffffff', fgColor: '#000000' }));
const out = path.resolve('screenshots', 'ipad-qr.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}`);

console.log(JSON.stringify({ user, url, qr: out }, null, 2));
