// Piaf — Edge Function `watch` : vérifie les fichiers suivis (dépôts GitHub publics) et prévient la personne ou la discussion.
// Appelée toutes les 15 minutes par pg_cron (voir 010_watchers.sql et docs/CONNECTEURS.md), JAMAIS par l'application.
// Déploiement : supabase functions deploy watch --no-verify-jwt   (l'appel est protégé par le secret WATCH_SECRET, pas par un jeton de personne)
// Secrets : WATCH_SECRET (32 caractères ou plus, obligatoire) ; GITHUB_TOKEN (facultatif : jeton en lecture seule des dépôts publics, relève la limite de 60 à 5 000 requêtes par heure).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { checkGithub, timingSafeEqual, type GhRef } from "./lib.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

type Due = { id: string; provider: string; ref: GhRef; last_sha: string | null; last_etag: string | null };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("WATCH_SECRET") ?? "";
  if (secret.length < 32) return json({ error: "server_misconfigured" }, 500);
  if (!timingSafeEqual(req.headers.get("x-watch-secret") ?? "", secret)) return json({ error: "forbidden" }, 403);

  const { data, error } = await admin.rpc("watch_due", { p_limit: 25 });
  if (error) return json({ error: "watch_due_failed" }, 500);
  const due = (data ?? []) as Due[];
  const token = Deno.env.get("GITHUB_TOKEN") || undefined;
  const stats = { due: due.length, changed: 0, unchanged: 0, errors: 0, skipped: 0, ratelimited: false };
  let stop = false;

  const one = async (w: Due) => {
    if (stop) { stats.skipped++; return; }
    if (w.provider !== "github") { stats.skipped++; return; }
    const r = await checkGithub(w.ref, { lastSha: w.last_sha, etag: w.last_etag }, { token });
    if (r.kind === "ratelimited") { stop = true; stats.ratelimited = true; return; }
    if (r.kind === "skip") { stats.skipped++; return; }
    if (r.kind === "error") {
      stats.errors++;
      await admin.rpc("watch_report", { p_id: w.id, p_sha: null, p_etag: null, p_body: null, p_url: null, p_error: r.reason });
      return;
    }
    if (r.kind === "unchanged") {
      stats.unchanged++;
      await admin.rpc("watch_report", { p_id: w.id, p_sha: null, p_etag: r.etag, p_body: null, p_url: null, p_error: null });
      return;
    }
    stats.changed++;
    await admin.rpc("watch_report", { p_id: w.id, p_sha: r.sha, p_etag: r.etag, p_body: r.body, p_url: r.url, p_error: null });
  };

  for (let i = 0; i < due.length; i += 5) await Promise.all(due.slice(i, i + 5).map((w) => one(w).catch(() => { stats.skipped++; })));
  return json(stats);
});
