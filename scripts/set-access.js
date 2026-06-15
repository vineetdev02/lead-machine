// Control which menus an agent can see.
//
// Usage:
//   node scripts/set-access.js <email> "Car Rental" "Hotels"   # only these menus
//   node scripts/set-access.js <email> all                      # see ALL menus
//   node scripts/set-access.js <email> none                     # see NOTHING
//
// Menu names are the display names (without the trailing " Leads").
const fs   = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, '..', 'users.json');

const EMAIL = process.argv[2];
const rest  = process.argv.slice(3);
if (!EMAIL || !rest.length) {
  console.error('Usage: node scripts/set-access.js <email> <"Menu A"> ["Menu B"...] | all | none');
  process.exit(1);
}

let users = [];
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch {}
if (!Array.isArray(users)) users = [];

const u = users.find(x => (x.email || '').toLowerCase() === EMAIL.toLowerCase());
if (!u) { console.error(`No such user: ${EMAIL} (create it first with add-user.js)`); process.exit(1); }

if (rest.length === 1 && rest[0].toLowerCase() === 'all') {
  delete u.allowedMenus;
  console.log(`${EMAIL} can now see ALL menus.`);
} else if (rest.length === 1 && rest[0].toLowerCase() === 'none') {
  u.allowedMenus = [];
  console.log(`${EMAIL} can now see NO menus.`);
} else {
  u.allowedMenus = [...new Set(rest.map(s => s.replace(/ Leads$/, '').trim()))];
  console.log(`${EMAIL} can now see only: ${u.allowedMenus.join(', ')}`);
}

fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf8');
console.log('Saved to users.json (takes effect immediately — no restart needed).');
