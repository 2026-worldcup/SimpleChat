// Piaf — Edge Function `media` : finalisation d'envoi, annulation, suppression pour tous, nettoyage.
// Elle seule peut SUPPRIMER un fichier du bucket (clé service_role côté serveur uniquement) et elle contrôle
// la taille RÉELLE de l'objet envoyé, pas celle déclarée par le navigateur.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const BUCKET = "chat-media";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Supprime le fichier puis libère la réservation. Si la suppression échoue, la ligne reste « pending »/« deleting »
// et sera reprise par `sweep` : le quota n'est jamais libéré tant que le fichier existe.
async function purge(id: string, path: string): Promise<boolean> {
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) { console.error("remove failed", path, error.message); return false; }
  await admin.rpc("media_mark_removed", { p_id: id });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(401, { error: "unauthorized" });

  let b: any;
  try { b = await req.json(); } catch { return json(400, { error: "bad_request" }); }

  try {
    if (b.action === "finalize") {
      const ids: string[] = Array.isArray(b.ids) ? b.ids.slice(0, 10).map(String) : [];
      const { data: cfg } = await admin.from("app_config").select("key,value").in("key", ["photo_max_bytes", "video_max_bytes"]);
      const limit: Record<string, number> = { photo: 0, video: 0 };
      for (const c of cfg ?? []) limit[c.key === "photo_max_bytes" ? "photo" : "video"] = Number(c.value);

      const results = [];
      for (const id of ids) {
        const { data: m } = await admin.from("media").select("id,path,kind,uploader_id,status").eq("id", id).maybeSingle();
        if (!m || m.uploader_id !== uid || m.status !== "pending") { results.push({ id, ok: false, error: "not_found" }); continue; }
        const { data: size } = await admin.rpc("media_object_size", { p_path: m.path });
        if (size == null) { results.push({ id, ok: false, error: "upload_missing" }); continue; }
        if (Number(size) > limit[m.kind]) { await purge(m.id, m.path); results.push({ id, ok: false, error: "file_too_large" }); continue; }
        const { error } = await admin.rpc("media_finalize", { p_user: uid, p_id: id, p_actual: Number(size) });
        if (error) { await purge(m.id, m.path); results.push({ id, ok: false, error: error.message }); continue; }
        results.push({ id, ok: true });
      }
      return json(200, { results });
    }

    if (b.action === "abort") { // annulation ou échec côté navigateur
      const ids: string[] = Array.isArray(b.ids) ? b.ids.slice(0, 10).map(String) : [];
      for (const id of ids) {
        const { data: m } = await admin.from("media").select("id,path,uploader_id,status").eq("id", id).maybeSingle();
        if (m && m.uploader_id === uid && m.status === "pending") await purge(m.id, m.path);
      }
      return json(200, { ok: true });
    }

    if (b.action === "delete") { // suppression pour tous : réservée à la personne qui a envoyé le fichier
      const id = String(b.id ?? "");
      const { data: path, error } = await admin.rpc("media_begin_delete", { p_user: uid, p_id: id });
      if (error || !path) return json(403, { error: "forbidden" });
      const ok = await purge(id, path as string);
      return ok ? json(200, { ok: true }) : json(502, { error: "delete_failed" }); // le média reste masqué ; `sweep` réessaiera
    }

    if (b.action === "sweep") { // réservations expirées + suppressions à reprendre
      const { data: stale } = await admin.rpc("media_stale", { p_user: uid });
      let cleaned = 0, failed = 0;
      for (const s of (stale ?? []) as { id: string; path: string }[]) (await purge(s.id, s.path)) ? cleaned++ : failed++;
      return json(200, { cleaned, failed });
    }

    if (b.action === "delete_group") { // dernière personne restante : suppression complète du groupe (messages, fichiers, photo)
      const id = String(b.id ?? "");
      const { data: mem } = await admin.from("conversation_members").select("user_id").eq("conversation_id", id);
      const { data: c } = await admin.from("conversations").select("kind").eq("id", id).maybeSingle();
      if (!c || c.kind !== "group" || !mem || mem.length !== 1 || mem[0].user_id !== uid) return json(403, { error: "forbidden" });
      const { data: files } = await admin.from("media").select("path").eq("conversation_id", id).neq("status", "deleted");
      const paths = (files ?? []).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (error) { console.error("group cleanup", error.message); return json(502, { error: "delete_failed" }); }
      }
      const { data: av } = await admin.storage.from("avatars").list(id);
      if (av?.length) await admin.storage.from("avatars").remove(av.map((f) => `${id}/${f.name}`));
      const { error } = await admin.from("conversations").delete().eq("id", id);
      return error ? json(500, { error: "server_error" }) : json(200, { ok: true });
    }

    return json(400, { error: "bad_request" });
  } catch (e) {
    console.error(e);
    return json(500, { error: "server_error" });
  }
});
