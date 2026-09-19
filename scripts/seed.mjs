// Seeds a demo account with a few clients through the public HTTP APIs, the
// same way the browser does, so it never bypasses validation or ownership.
// Needs `make dev` running. Safe to run twice: it adds clients only when the
// demo user has none.
const WEB = process.env.SEED_WEB_URL ?? "http://localhost:3100";
const EMAIL = process.env.SEED_EMAIL ?? "demo@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

const CLIENTS = [
  { name: "Andes Coffee Roasters", email: "billing@andescoffee.test", tax_id: "20501234561" },
  { name: "Pacific Freight SAC", email: "accounts@pacificfreight.test", tax_id: "20601234562" },
  { name: "Lima Design Studio", email: "hola@limadesign.test" },
  { name: "Quispe & Asociados", tax_id: "20701234563", notes: "Prefers email." },
  { name: "Rosa Mendoza", email: "rosa@example.test", notes: "Met at the spring conference." },
];

async function post(path, body, headers = {}) {
  return fetch(WEB + path, {
    method: "POST",
    // Better Auth rejects cross-site POSTs, so send the origin a browser would.
    headers: { "content-type": "application/json", origin: WEB, ...headers },
    body: JSON.stringify(body),
  });
}

async function signIn() {
  let res = await post("/api/auth/sign-in/email", { email: EMAIL, password: PASSWORD });
  if (!res.ok) {
    res = await post("/api/auth/sign-up/email", { email: EMAIL, password: PASSWORD, name: "Demo User" });
  }
  if (!res.ok) {
    throw new Error(`could not sign in or sign up ${EMAIL}: ${res.status} ${await res.text()}`);
  }
  return res.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function main() {
  const cookie = await signIn();

  const tokenRes = await fetch(WEB + "/api/auth/token", { headers: { cookie } });
  if (!tokenRes.ok) throw new Error(`could not get an API token: ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await fetch(WEB + "/api/v1/clients?limit=1", { headers: auth });
  if (!listRes.ok) throw new Error(`could not list clients: ${listRes.status} ${await listRes.text()}`);
  const { items } = await listRes.json();
  if (items.length > 0) {
    console.log(`${EMAIL} already has clients; nothing to do.`);
    return;
  }

  for (const client of CLIENTS) {
    const res = await post("/api/v1/clients", client, auth);
    if (!res.ok) throw new Error(`could not create ${client.name}: ${res.status} ${await res.text()}`);
  }
  console.log(`Seeded ${CLIENTS.length} clients for ${EMAIL} (password: ${PASSWORD}).`);
}

main().catch((error) => {
  console.error(error.message);
  console.error(`Is \`make dev\` running at ${WEB}?`);
  process.exit(1);
});
