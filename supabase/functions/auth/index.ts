// Piaf — Edge Function `auth` : inscription, connexion, suppression de compte.
//
// Pourquoi une fonction serveur : Supabase Auth ne propose pas nativement « identifiant à 8 chiffres + code secret ».
// Solution : chaque compte a un e-mail technique `<identifiant>@piaf.invalid` (jamais utilisé pour écrire à quelqu'un,
// aucune confirmation requise). La fonction :
//   1. génère l'identifiant (aléatoire, non séquentiel, collisions gérées par l'unicité de l'e-mail) ;
//   2. n'envoie JAMAIS le code secret brut à GoTrue : le mot de passe réel est HMAC-SHA256(PIAF_PEPPER, id + code).
//      Sans le « poivre » (secret serveur), deviner un code directement auprès de /auth/v1/token est impossible :
//      toutes les tentatives doivent passer ici, où elles sont limitées (verrouillage progressif) ;
//   3. renvoie une vraie session Supabase (jeton d'accès + jeton de rafraîchissement) que le navigateur conserve.
// Secrets requis : PIAF_PEPPER (à définir une fois ; le perdre rend tous les comptes inaccessibles).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = Deno.env.get("PIAF_PEPPER") ?? "";

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function hmac(msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const derive = async (id: string, secret: string) => b64url(await hmac(`pw:${id}:${secret.normalize("NFKC")}`));
const emailOf = (id: string) => `${id}@piaf.invalid`;

function randomId(): string {
  // 8 chiffres, premier chiffre 1-9, tirage rejeté pour éviter le biais modulo.
  const buf = new Uint32Array(1);
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= 4_294_967_295 - (4_294_967_295 % 90_000_000));
  return String(10_000_000 + (n % 90_000_000));
}

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  return b64url(await hmac(`ip:${ip}`)).slice(0, 22);
}

// ---------------------------------------------------------------- limitation des tentatives
// 5 échecs depuis la même IP pour un identifiant => 15 min ; 30 échecs toutes IP confondues => 60 min.
async function lockedFor(keys: string[]): Promise<number> {
  const { data } = await admin.from("login_attempts").select("locked_until").in("key", keys);
  const now = Date.now();
  let wait = 0;
  for (const r of data ?? []) {
    const t = r.locked_until ? new Date(r.locked_until).getTime() - now : 0;
    if (t > wait) wait = t;
  }
  return Math.ceil(wait / 1000);
}
async function recordFailure(id: string, ip: string) {
  const rules: [string, number, number][] = [[`idip:${id}:${ip}`, 5, 15], [`id:${id}`, 30, 60]];
  for (const [key, max, lockMin] of rules) {
    const { data: row } = await admin.from("login_attempts").select("*").eq("key", key).maybeSingle();
    const fresh = !row || Date.now() - new Date(row.window_start).getTime() > 3_600_000;
    const failures = (fresh ? 0 : row.failures) + 1;
    const locked_until = failures >= max ? new Date(Date.now() + lockMin * 60_000).toISOString() : (fresh ? null : row.locked_until);
    await admin.from("login_attempts").upsert({
      key, failures, window_start: fresh ? new Date().toISOString() : row.window_start, locked_until,
    });
  }
}
const clearFailures = (id: string, ip: string) =>
  admin.from("login_attempts").delete().in("key", [`idip:${id}:${ip}`, `id:${id}`]);

// Vérifie (id, code) en respectant le verrouillage. Renvoie la session ou une Response d'erreur.
async function verify(id: string, secret: string, ip: string) {
  const wait = await lockedFor([`idip:${id}:${ip}`, `id:${id}`]);
  if (wait > 0) return { err: json(429, { error: "locked", retry_after: wait }) };
  const { data, error } = await anon().auth.signInWithPassword({ email: emailOf(id), password: await derive(id, secret) });
  if (error || !data.session) {
    await recordFailure(id, ip);
    return { err: json(401, { error: "invalid_credentials" }) }; // message volontairement identique : id inconnu / code faux
  }
  await clearFailures(id, ip);
  return { session: data.session };
}

const sessionOut = (s: any) => ({
  access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type,
});

// ---------------------------------------------------------------- actions
async function signup(req: Request, b: any) {
  const name = String(b.display_name ?? "").trim();
  const secret = String(b.password ?? "");
  if (name.length < 1 || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return json(400, { error: "invalid_name" });
  if (secret.length < 8 || secret.length > 64) return json(400, { error: "invalid_password" });

  const ip = await ipHash(req);
  const since = new Date(Date.now() - 3_600_000).toISOString();
  // Conservation courte des données anti-abus : empreintes d'IP 7 jours, compteurs de connexion 2 jours.
  await admin.from("signup_log").delete().lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  await admin.from("login_attempts").delete().lt("window_start", new Date(Date.now() - 2 * 86_400_000).toISOString());
  const [{ count: byIp }, { count: global }] = await Promise.all([
    admin.from("signup_log").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", since),
    admin.from("signup_log").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);
  if ((byIp ?? 0) >= 10 || (global ?? 0) >= 200) return json(429, { error: "signup_rate_limited" });

  const { data: gate } = await admin.from("signup_gate").select("token").limit(1).maybeSingle();
  if (!gate?.token) { console.error("signup_gate vide"); return json(500, { error: "server_misconfigured" }); }
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = randomId();
    const { error } = await admin.auth.admin.createUser({
      email: emailOf(id), password: await derive(id, secret), email_confirm: true,
      app_metadata: { piaf: "1" }, user_metadata: { display_name: name, piaf_gate: gate.token },
    });
    if (error) {
      if (/already|exists|registered|duplicate/i.test(error.message)) continue; // collision : on retire un autre identifiant
      console.error("createUser", error.message);
      return json(500, { error: "signup_failed" });
    }
    await admin.from("signup_log").insert({ ip_hash: ip });
    const { data, error: e2 } = await anon().auth.signInWithPassword({ email: emailOf(id), password: await derive(id, secret) });
    if (e2 || !data.session) return json(500, { error: "signup_failed" });
    return json(200, { public_id: id, display_name: name, session: sessionOut(data.session) });
  }
  return json(500, { error: "signup_failed" });
}

async function login(req: Request, b: any) {
  const id = String(b.public_id ?? "").trim();
  const secret = String(b.password ?? "");
  if (!/^[1-9][0-9]{7}$/.test(id) || secret.length < 1 || secret.length > 64) return json(401, { error: "invalid_credentials" });
  const r = await verify(id, secret, await ipHash(req));
  if (r.err) return r.err;
  return json(200, { public_id: id, session: sessionOut(r.session) });
}

async function deleteAccount(req: Request, b: any) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json(401, { error: "unauthorized" });
  const id = (u.user.email ?? "").split("@")[0];
  const r = await verify(id, String(b.password ?? ""), await ipHash(req));
  if (r.err) return r.err;

  // 1) supprimer réellement tous les fichiers des conversations de la personne ; en cas d'échec on s'arrête (rien n'est perdu à moitié).
  const { data: convs } = await admin.from("conversations").select("id").or(`user_a.eq.${u.user.id},user_b.eq.${u.user.id}`);
  const ids = (convs ?? []).map((c) => c.id);
  if (ids.length) {
    const { data: files } = await admin.from("media").select("path").in("conversation_id", ids).neq("status", "deleted");
    const paths = (files ?? []).map((f) => f.path);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from("chat-media").remove(paths.slice(i, i + 100));
      if (error) { console.error("storage cleanup", error.message); return json(502, { error: "storage_cleanup_failed" }); }
    }
  }
  // 1b) photos de profil de la personne
  const { data: av } = await admin.storage.from("avatars").list(u.user.id);
  if (av?.length) await admin.storage.from("avatars").remove(av.map((f) => `${u.user.id}/${f.name}`));
  // 2) supprimer le compte : les profils, conversations, messages et métadonnées partent en cascade.
  const { error } = await admin.auth.admin.deleteUser(u.user.id);
  if (error) return json(500, { error: "delete_failed" });
  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!PEPPER || PEPPER.length < 32) return json(500, { error: "server_misconfigured" });
  let b: any;
  try { b = await req.json(); } catch { return json(400, { error: "bad_request" }); }
  try {
    switch (b.action) {
      case "signup": return await signup(req, b);
      case "login": return await login(req, b);
      case "delete_account": return await deleteAccount(req, b);
      default: return json(400, { error: "bad_request" });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: "server_error" });
  }
});
