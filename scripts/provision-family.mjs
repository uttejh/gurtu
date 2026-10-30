import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

try { process.loadEnvFile(); } catch { /* .env is optional when variables are exported directly. */ }

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this setup in an interactive terminal so passwords can be masked.');
  process.exit(1);
}

process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);
process.stdin.resume();

function prompt(label, { secret = false, defaultValue = '' } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `);
    let value = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') process.exit(130);
        if (character === '\r' || character === '\n') {
          process.stdout.write('\n');
          process.stdin.off('data', onData);
          resolve(value.trim() || defaultValue);
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          process.stdout.write(secret ? '*' : character);
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function required(label, options) {
  while (true) {
    const value = await prompt(label, options);
    if (value.trim()) return value.trim();
    process.stdout.write('Please enter a value.\n');
  }
}

async function timeZone(label) {
  while (true) {
    const value = await required(label);
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date());
      return value;
    } catch {
      process.stdout.write('Enter a valid IANA time zone such as America/Toronto.\n');
    }
  }
}

function aliases(value, defaults = []) {
  const submitted = value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
  return [...new Set([...defaults, ...submitted])].slice(0, 30);
}

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error('Add SUPABASE_URL and SUPABASE_SECRET_KEY to the ignored local .env first.');
  process.stdin.setRawMode(false);
  process.exit(1);
}

const familyName = await required('Family name');
const householdNames = {
  parents: await required('Parents household name', { defaultValue: 'Parents' }),
  my_household: await required('Your household name', { defaultValue: 'My household' }),
  brother_household: await required("Your brother's household name", { defaultValue: "Brother's household" }),
};
const zones = {
  parents: 'Asia/Kolkata',
  my_household: await timeZone('Your household IANA time zone'),
  brother_household: await timeZone("Your brother's household IANA time zone"),
};

const definitions = [
  { key: 'parents', label: 'Parents shared login', household_key: 'parents', defaultName: 'Parents shared account' },
  { key: 'me', label: 'Your login', household_key: 'my_household', defaultName: 'Me' },
  { key: 'wife', label: "Your wife's login", household_key: 'my_household', defaultName: 'Wife' },
  { key: 'brother', label: "Your brother's login", household_key: 'brother_household', defaultName: 'Brother' },
  { key: 'sister_in_law', label: "Your brother's wife's login", household_key: 'brother_household', defaultName: 'Sister in law' },
];

const accounts = [];
for (const definition of definitions) {
  const email = (await required(`${definition.label} email`)).toLowerCase();
  const display_name = await required(`${definition.label} profile name`, { defaultValue: definition.defaultName });
  let password;
  let confirmation;
  do {
    password = await required(`${definition.label} password (12+ characters)`, { secret: true });
    confirmation = await required('Confirm password', { secret: true });
    if (password.length < 12 || password !== confirmation) process.stdout.write('Use at least 12 characters and enter the same password twice.\n');
  } while (password.length < 12 || password !== confirmation);
  accounts.push({ ...definition, email, display_name, password });
}
if (new Set(accounts.map((account) => account.email)).size !== accounts.length) {
  console.error('Each login account needs a different email address. No accounts were created.');
  process.stdin.setRawMode(false);
  process.exit(1);
}

const people = [];
for (const person of [
  { household_key: 'parents', label: 'Mom', defaultAliases: ['Mom', 'Amma', 'అమ్మ'] },
  { household_key: 'parents', label: 'Dad', defaultAliases: ['Dad', 'Nanna', 'నాన్న'] },
  { household_key: 'my_household', label: 'You', defaultAliases: [] },
  { household_key: 'my_household', label: "Your wife", defaultAliases: [] },
  { household_key: 'brother_household', label: 'Your brother', defaultAliases: [] },
  { household_key: 'brother_household', label: "Your brother's wife", defaultAliases: [] },
]) {
  const display_name = await required(`${person.label} name`);
  const extra = await prompt(`${person.label} additional aliases (comma separated, optional)`);
  people.push({ household_key: person.household_key, display_name, aliases: aliases(extra, person.defaultAliases) });
}

process.stdin.setRawMode(false);
process.stdout.write('\nCreating the five Auth users and their private family records…\n');
const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
const createdUsers = [];
try {
  for (const account of accounts) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { display_name: account.display_name },
    });
    account.password = '';
    if (error || !data.user) throw new Error('An account could not be created. Check the email addresses and try again.');
    createdUsers.push({ id: data.user.id, household_key: account.household_key, display_name: account.display_name });
  }

  const { data, error } = await supabase.rpc('provision_gurtu_family', {
    p_family_name: familyName,
    p_households: Object.entries(householdNames).map(([key, name]) => ({ key, name, timezone: zones[key] })),
    p_profiles: accounts.map((account, index) => ({ user_id: createdUsers[index].id, household_key: account.household_key, display_name: account.display_name })),
    p_people: people,
  });
  if (error || !data) throw new Error('The family records could not be created.');
  process.stdout.write('Family setup is complete: 3 households, 5 logins and 6 people.\n');
  process.stdout.write(`Family ID: ${data.family_id}\n`);
} catch (error) {
  for (const user of createdUsers.reverse()) await supabase.auth.admin.deleteUser(user.id);
  for (const account of accounts) account.password = '';
  console.error(error instanceof Error ? error.message : 'Family setup could not be completed.');
  console.error('Any accounts created during this run were removed because the database setup did not finish.');
  process.exit(1);
}
