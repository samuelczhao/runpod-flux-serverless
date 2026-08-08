const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 640;
const CENTER_X = VIEWBOX_WIDTH / 2;
const CENTER_Y = VIEWBOX_HEIGHT / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const START_RADIUS = 46;
const RADIUS_GROWTH = 31;
const MAX_RADIUS = 250;
const HORIZONTAL_SCALE = 1.55;

export interface ConstellationMotif {
  readonly slug: string;
  readonly label: string;
}

export interface ConstellationDream {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly motifs: readonly ConstellationMotif[];
}

export interface ConstellationNode {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
}

export interface ConstellationEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly motifs: readonly string[];
  readonly weight: number;
}

export interface RecurringMotif {
  readonly slug: string;
  readonly label: string;
  readonly count: number;
}

export interface ConstellationGraph {
  readonly nodes: readonly ConstellationNode[];
  readonly edges: readonly ConstellationEdge[];
  readonly recurringMotifs: readonly RecurringMotif[];
}

export function buildConstellation(input: readonly ConstellationDream[]): ConstellationGraph {
  const dreams = [...input].sort(compareDreams);
  const recurringMotifs = findRecurringMotifs(dreams);
  return {
    nodes: dreams.map(toNode),
    edges: buildEdges(dreams, recurringMotifs),
    recurringMotifs,
  };
}

function compareDreams(left: ConstellationDream, right: ConstellationDream): number {
  const dateOrder = left.createdAt.localeCompare(right.createdAt);
  return dateOrder || left.id.localeCompare(right.id);
}

function toNode(dream: ConstellationDream, index: number): ConstellationNode {
  if (index === 0) return { id: dream.id, title: dream.title, x: CENTER_X, y: CENTER_Y };
  const angle = -Math.PI / 2 + (index * GOLDEN_ANGLE);
  const radius = Math.min(MAX_RADIUS, START_RADIUS + (RADIUS_GROWTH * Math.sqrt(index)));
  return {
    id: dream.id,
    title: dream.title,
    x: round(CENTER_X + (Math.cos(angle) * radius * HORIZONTAL_SCALE)),
    y: round(CENTER_Y + (Math.sin(angle) * radius)),
  };
}

function findRecurringMotifs(dreams: readonly ConstellationDream[]): RecurringMotif[] {
  const motifs = new Map<string, { label: string; dreamIds: Set<string> }>();
  for (const dream of dreams) collectDreamMotifs(motifs, dream);
  return [...motifs.entries()]
    .filter(([, motif]) => motif.dreamIds.size > 1)
    .map(([slug, motif]) => ({ slug, label: motif.label, count: motif.dreamIds.size }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function collectDreamMotifs(
  motifs: Map<string, { label: string; dreamIds: Set<string> }>,
  dream: ConstellationDream,
): void {
  for (const motif of dream.motifs) {
    const current = motifs.get(motif.slug) ?? { label: motif.label, dreamIds: new Set<string>() };
    current.dreamIds.add(dream.id);
    motifs.set(motif.slug, current);
  }
}

function buildEdges(
  dreams: readonly ConstellationDream[],
  motifs: readonly RecurringMotif[],
): ConstellationEdge[] {
  const edges = new Map<string, { sourceId: string; targetId: string; motifs: string[] }>();
  for (const motif of motifs) {
    const ids = dreams.filter((dream) => hasMotif(dream, motif.slug)).map((dream) => dream.id);
    for (let index = 1; index < ids.length; index += 1) addEdge(edges, ids[index - 1], ids[index], motif.label);
  }
  return [...edges.entries()].map(([id, edge]) => ({
    id, ...edge, motifs: edge.motifs.sort(), weight: edge.motifs.length,
  }));
}

function hasMotif(dream: ConstellationDream, slug: string): boolean {
  return dream.motifs.some((motif) => motif.slug === slug);
}

function addEdge(
  edges: Map<string, { sourceId: string; targetId: string; motifs: string[] }>,
  sourceId: string,
  targetId: string,
  motif: string,
): void {
  const id = `${sourceId}->${targetId}`;
  const edge = edges.get(id) ?? { sourceId, targetId, motifs: [] };
  if (!edge.motifs.includes(motif)) edge.motifs.push(motif);
  edges.set(id, edge);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
