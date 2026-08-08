import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ConstellationDream, ConstellationMotif } from "@/lib/domain/constellation";
import { dreamStatusSchema, motifKindSchema } from "@/lib/domain/dream";
import { parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import type { Database } from "@/lib/database/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const journalDreamSchema = z.object({
  id: z.uuid(), title: z.string().nullable(), summary: z.string().nullable(),
  status: dreamStatusSchema, mood: z.array(z.string()), created_at: z.string(),
}).strict();
const dreamMotifSchema = z.object({ dream_id: z.uuid(), motif_id: z.uuid() }).strict();
const journalMotifSchema = z.object({
  id: z.uuid(), canonical_label: z.string(), slug: z.string(), kind: motifKindSchema,
}).strict();

export type JournalDream = z.infer<typeof journalDreamSchema>;

export interface JournalData {
  readonly dreams: readonly JournalDream[];
  readonly constellationDreams: readonly ConstellationDream[];
}

export async function loadJournal(): Promise<JournalData> {
  const client = await createSupabaseServerClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return { dreams: [], constellationDreams: [] };
  const dreams = await loadDreams(client);
  const readyDreams = dreams.filter((dream) => dream.status === "READY");
  const motifs = await loadMotifs(client, readyDreams.map((dream) => dream.id));
  return { dreams, constellationDreams: toConstellationDreams(readyDreams, motifs) };
}

async function loadDreams(client: SupabaseClient<Database>): Promise<JournalDream[]> {
  const result = await client.from("dreams").select(DREAM_FIELDS)
    .neq("status", "DELETING").order("created_at", { ascending: false }).limit(50);
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(journalDreamSchema, result.data);
}

async function loadMotifs(
  client: SupabaseClient<Database>,
  dreamIds: readonly string[],
): Promise<Map<string, ConstellationMotif[]>> {
  if (!dreamIds.length) return new Map();
  const result = await client.from("dream_motifs").select("dream_id,motif_id").in("dream_id", dreamIds);
  throwIfDatabaseError(result.error);
  const links = parseDatabaseRows(dreamMotifSchema, result.data);
  return loadAndGroupMotifs(client, links);
}

async function loadAndGroupMotifs(
  client: SupabaseClient<Database>,
  links: readonly z.infer<typeof dreamMotifSchema>[],
): Promise<Map<string, ConstellationMotif[]>> {
  const motifIds = [...new Set(links.map((link) => link.motif_id))];
  if (!motifIds.length) return new Map();
  const result = await client.from("motifs").select(MOTIF_FIELDS).in("id", motifIds);
  throwIfDatabaseError(result.error);
  return groupMotifs(links, parseDatabaseRows(journalMotifSchema, result.data));
}

function groupMotifs(
  links: readonly z.infer<typeof dreamMotifSchema>[],
  motifs: readonly z.infer<typeof journalMotifSchema>[],
): Map<string, ConstellationMotif[]> {
  const motifById = new Map(motifs.map((motif) => [motif.id, motif]));
  const byDream = new Map<string, ConstellationMotif[]>();
  for (const link of links) appendMotif(byDream, link.dream_id, motifById.get(link.motif_id));
  return byDream;
}

function appendMotif(
  byDream: Map<string, ConstellationMotif[]>,
  dreamId: string,
  motif: z.infer<typeof journalMotifSchema> | undefined,
): void {
  if (!motif) return;
  const current = byDream.get(dreamId) ?? [];
  current.push({ slug: motif.slug, label: motif.canonical_label });
  byDream.set(dreamId, current);
}

function toConstellationDreams(
  dreams: readonly JournalDream[],
  motifs: ReadonlyMap<string, readonly ConstellationMotif[]>,
): ConstellationDream[] {
  return dreams.map((dream) => ({
    id: dream.id, title: dream.title ?? "Untitled dream",
    createdAt: dream.created_at, motifs: motifs.get(dream.id) ?? [],
  }));
}

const DREAM_FIELDS = "id,title,summary,status,mood,created_at";
const MOTIF_FIELDS = "id,canonical_label,slug,kind";
