#!/usr/bin/env node
/**
 * Set or change the admin password.
 *
 *   npm run admin:setup                 interactive (input hidden), writes server/.data/credentials.json
 *   npm run admin:setup -- --print-hash only prints the hash, for ADMIN_PASSWORD_HASH on a host
 *   ADMIN_NEW_PASSWORD=... npm run admin:setup   non-interactive (CI / scripted setup)
 *
 * Only a salted scrypt hash is stored. The file is created with mode 600 and is
 * git-ignored. Never commit it.
 */
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, checkPasswordStrength, saveCredentials } from './lib/auth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = process.env.ADMIN_CREDENTIALS_FILE || join(root, 'server', '.data', 'credentials.json');
const printOnly = process.argv.includes('--print-hash');

function askHidden(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
      else rl.output.write('');
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolveAnswer(answer);
    });
  });
}

let password = process.env.ADMIN_NEW_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('Run this in a terminal, or provide ADMIN_NEW_PASSWORD.');
    process.exit(1);
  }
  password = await askHidden('New admin password (min 12 characters): ');
  const again = await askHidden('Repeat password: ');
  if (password !== again) {
    console.error('Passwords do not match. Nothing was changed.');
    process.exit(1);
  }
}
const problems = checkPasswordStrength(password);
if (problems.length) {
  console.error(`Password rejected: ${problems.join('. ')}.`);
  process.exit(1);
}
const hash = await hashPassword(password);
if (printOnly) {
  console.log('\nSet this as ADMIN_PASSWORD_HASH on your server (keep it secret):\n');
  console.log(hash);
} else {
  await saveCredentials(file, hash);
  console.log(`\nAdmin password saved (scrypt hash) to ${file}`);
  console.log('Start the dashboard with: npm run admin');
}
