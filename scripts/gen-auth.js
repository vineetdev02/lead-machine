// One-time bootstrap: generate password hash, TOTP secret, JWT secret.
// Renders the QR for Google Authenticator and prints env-var lines.
const bcrypt    = require('bcryptjs');
const otp       = require('otplib');
const qrcode    = require('qrcode-terminal');
const crypto    = require('crypto');

const EMAIL    = process.argv[2];
const PASSWORD = process.argv[3];
const ISSUER   = 'LeadHunter';
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/gen-auth.js <email> <password>');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(PASSWORD, 12);
const totpSecret   = otp.generateSecret({ encoding: 'base32' });
const jwtSecret    = crypto.randomBytes(48).toString('hex');
const otpauthUrl   = otp.generateURI({ secret: totpSecret, encoding: 'base32', label: EMAIL, issuer: ISSUER });

console.log('\n── Scan this QR with Google Authenticator ──\n');
qrcode.generate(otpauthUrl, { small: true });
console.log('\nIf QR fails, manually enter this secret in Google Authenticator:');
console.log('  ' + totpSecret);
console.log('\notpauth URL:');
console.log('  ' + otpauthUrl);
console.log('\n── Set these on Railway ──');
console.log('ADMIN_EMAIL=' + EMAIL);
console.log('PASSWORD_HASH=' + passwordHash);
console.log('TOTP_SECRET=' + totpSecret);
console.log('JWT_SECRET=' + jwtSecret);
console.log('');
