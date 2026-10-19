// Piaf — suivi de fichiers : logique pure de l'Edge Function `watch` (sans dépendance, testable sous Node et Deno).
// Elle ne lit que des informations publiques de l'API GitHub et ne stocke aucun jeton de personne.

export type GhRef = { owner: string; repo: string; path?: string; branch?: string };
export type Commit = { sha: string; title: string; author: string; date: string; url: string };
export type CheckState = { lastSha: string | null; etag: string | null };
export type CheckResult =
  | { kind: "unchanged"; etag: string | null }
  | { kind: "changed"; sha: string; etag: string | null; body: string; url: string }
  | { kind: "error"; reason: string }            // durable : dépôt introuvable, privé, chemin inexistant…
  | { kind: "skip"; reason: string }             // passager : panne GitHub, réseau → on réessaiera, sans compter d'échec
  | { kind: "ratelimited"; resetAt: number | null };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function validRef(r: GhRef): boolean {
  if (!r || !OWNER_RE.test(r.owner) || !REPO_RE.test(r.repo) || r.repo === "." || r.repo === "..") return false;
  if (r.path && (r.path.length > 300 || /[\u0000-\u001f]/.test(r.path) || /(^|\/)\.\.(\/|$)/.test(r.path))) return false;
  if (r.branch && (!/^[A-Za-z0-9._/-]{1,100}$/.test(r.branch) || r.branch.includes(".."))) return false;
  return true;
}

export const refLabel = (r: GhRef) => `${r.owner}/${r.repo}${r.path ? "/" + r.path : ""}${r.branch ? " (" + r.branch + ")" : ""}`;

export function commitsUrl(r: GhRef, perPage = 10): string {
  const u = new URL(`https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/commits`);
  if (r.path) u.searchParams.set("path", r.path);
  if (r.branch) u.searchParams.set("sha", r.branch);
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}

// Texte venu de GitHub (message de commit, nom d'auteur) : on retire les caractères de contrôle et les liens, qui n'ont pas à être relayés tels quels dans une discussion.
export function clean(s: unknown, max: number): string {
  let t = String(s ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/https?:\/\/\S+/gi, "[lien]").replace(/\s+/g, " ").trim();
  if (t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

export function parseCommits(json: unknown): Commit[] {
  if (!Array.isArray(json)) return [];
  const out: Commit[] = [];
  for (const c of json) {
    const sha = c && typeof c.sha === "string" && /^[0-9a-f]{40}$/i.test(c.sha) ? c.sha.toLowerCase() : null;
    if (!sha) continue;
    const msg = String(c.commit?.message ?? "").split("\n")[0];
    out.push({
      sha, title: clean(msg, 120) || "(sans message)",
      author: clean(c.commit?.author?.name ?? c.author?.login ?? "auteur inconnu", 40),
      date: String(c.commit?.committer?.date ?? c.commit?.author?.date ?? ""),
      url: typeof c.html_url === "string" && /^https:\/\/github\.com\//.test(c.html_url) ? c.html_url : "",
    });
  }
  return out;
}

// Les commits plus récents que la dernière version vue (la liste est du plus récent au plus ancien).
export function fresh(commits: Commit[], lastSha: string | null): { list: Commit[]; more: boolean } {
  if (!lastSha) return { list: commits.slice(0, 1), more: false };
  const i = commits.findIndex((c) => c.sha === lastSha);
  if (i === -1) return { list: commits, more: true };     // plus de 10 modifications depuis, ou historique réécrit
  return { list: commits.slice(0, i), more: false };
}

const frDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).replace(" à ", " à ");
};

// Message publié dans la discussion ou déposé comme alerte (texte brut, 1500 caractères au plus).
export function buildMessage(r: GhRef, f: { list: Commit[]; more: boolean }): { body: string; url: string } {
  const top = f.list[0];
  const what = r.path ? `Fichier suivi modifié : ${refLabel(r)}` : `Dépôt suivi modifié : ${refLabel(r)}`;
  const lines = [`🔔 ${what}`, `« ${top.title} », par ${top.author}${top.date ? ", le " + frDate(top.date) : ""}`];
  if (f.list.length > 1 || f.more) lines.push(f.more ? "Plus de 10 modifications depuis ma dernière vérification." : `Et ${f.list.length - 1} autre${f.list.length > 2 ? "s" : ""} modification${f.list.length > 2 ? "s" : ""} depuis ma dernière vérification.`);
  const url = top.url || `https://github.com/${r.owner}/${r.repo}`;
  lines.push(url);
  return { body: lines.join("\n").slice(0, 1500), url };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// Une vérification. `opts.token` (facultatif, jeton GitHub en lecture seule des dépôts publics) relève la limite de requêtes ; `opts.fetch` sert aux tests.
export async function checkGithub(r: GhRef, st: CheckState, opts: { token?: string; fetch?: Fetch; timeoutMs?: number } = {}): Promise<CheckResult> {
  if (!validRef(r)) return { kind: "error", reason: "invalid_ref" };
  const f: Fetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "piaf-watch" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (st.etag && st.lastSha) headers["If-None-Match"] = st.etag;
  let res: Response;
  try { res = await f(commitsUrl(r), { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 7000) }); }
  catch (e) { return { kind: "skip", reason: "network" }; }
  const etag = res.headers.get("etag");
  if (res.status === 304) return { kind: "unchanged", etag };
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429 || res.headers.has("retry-after")) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      return { kind: "ratelimited", resetAt: Number.isFinite(reset) && reset > 0 ? reset : null };
    }
    return { kind: "error", reason: "forbidden" };
  }
  if (res.status === 404 || res.status === 410 || res.status === 451) return { kind: "error", reason: "not_found" };
  if (res.status === 409) return { kind: "error", reason: "empty_repository" };
  if (res.status >= 500 || res.status !== 200) return { kind: "skip", reason: "http_" + res.status };
  let json: unknown;
  try { json = await res.json(); } catch { return { kind: "skip", reason: "bad_json" }; }
  const commits = parseCommits(json);
  if (!commits.length) return { kind: "error", reason: r.path ? "path_not_found" : "no_commits" };
  const head = commits[0];
  if (head.sha === st.lastSha) return { kind: "unchanged", etag };
  if (!st.lastSha) return { kind: "changed", sha: head.sha, etag, body: "", url: head.url };           // point de départ : le serveur n'annonce rien
  const m = buildMessage(r, fresh(commits, st.lastSha));
  return { kind: "changed", sha: head.sha, etag, body: m.body, url: m.url };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
