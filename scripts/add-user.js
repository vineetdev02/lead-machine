// Create or update an account in users.json.
//
// 2FA is shared: every account verifies against the OWNER's authenticator
// (TOTP_SECRET in .env). Agents do NOT get their own QR/secret — they ask the
// owner for the current 6-digit code. So this script only sets email + password
// + role. No QR, no secret is ever generated or printed.
//
// Usage: node scripts/add-user.js <email> <password> [role]
//   role defaults to "agent" (can manage/update leads, but cannot generate
//   leads, add leads, delete, or change settings). Use "admin" for full access.
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const EMAIL    = process.argv[2];
const PASSWORD = process.argv[3];
const ROLE     = (process.argv[4] || 'agent').toLowerCase() === 'admin' ? 'admin' : 'agent';
const USERS_FILE = path.join(__dirname, '..', 'users.json');

if (!EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/add-user.js <email> <password> [role]');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(PASSWORD, 12);

let users = [];
try {
  const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  if (Array.isArray(arr)) users = arr;
} catch { /* new file */ }

const i = users.findIndex(u => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
const record = { email: EMAIL, passwordHash, role: ROLE };
if (i >= 0) { users[i] = record; console.log(`\nUpdated existing user: ${EMAIL}`); }
else { users.push(record); console.log(`\nCreated new user: ${EMAIL}`); }

fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf8');

console.log(`Role: ${ROLE}`);
console.log('\n── Login with ──');
console.log('  Email:    ' + EMAIL);
console.log('  Password: ' + PASSWORD);
console.log('  2FA:      ask the owner for the current Google Authenticator code');
console.log('\nSaved to users.json. No QR needed — 2FA uses the owner\'s authenticator.\n');
