import { describe, expect, it } from "vitest";
import { buildConstellation, type ConstellationDream } from "@/lib/domain/constellation";

const TRAIN = { slug: "silver-train", label: "silver train" };
const MOON = { slug: "moonlit-lake", label: "moonlit lake" };

describe("buildConstellation", () => {
  it("sorts deterministically and places the oldest dream at the center", () => {
    const graph = buildConstellation([dream("b", "2026-08-02", []), dream("a", "2026-08-01", [])]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(graph.nodes[0]).toMatchObject({ x: 500, y: 320 });
  });

  it("handles empty and one-dream journals", () => {
    expect(buildConstellation([])).toEqual({ nodes: [], edges: [], recurringMotifs: [] });
    expect(buildConstellation([dream("a", "2026-08-01", [TRAIN])]).edges).toEqual([]);
  });

  it("keeps every node inside the viewbox", () => {
    const dreams = Array.from({ length: 100 }, (_, index) => dream(`${index}`, date(index), []));
    for (const node of buildConstellation(dreams).nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1000);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(640);
    }
  });

  it("creates k minus one chronological edges for a recurring motif", () => {
    const graph = buildConstellation([
      dream("a", "2026-08-01", [TRAIN]), dream("b", "2026-08-02", [TRAIN]),
      dream("c", "2026-08-03", [TRAIN]),
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["a->b", "b->c"]);
    expect(graph.recurringMotifs).toEqual([{ slug: TRAIN.slug, label: TRAIN.label, count: 3 }]);
  });

  it("collapses multiple shared motifs into one weighted edge", () => {
    const graph = buildConstellation([
      dream("a", "2026-08-01", [TRAIN, MOON]), dream("b", "2026-08-02", [TRAIN, MOON]),
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ sourceId: "a", targetId: "b", weight: 2 });
    expect(graph.edges[0].motifs).toEqual(["moonlit lake", "silver train"]);
  });

  it("does not add loops or duplicate a motif repeated within one dream", () => {
    const graph = buildConstellation([
      dream("a", "2026-08-01", [TRAIN, TRAIN]), dream("b", "2026-08-02", [TRAIN]),
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].sourceId).not.toBe(graph.edges[0].targetId);
    expect(graph.recurringMotifs[0].count).toBe(2);
  });

  it("does not move existing nodes when a newer dream is appended", () => {
    const first = [dream("a", "2026-08-01", []), dream("b", "2026-08-02", [])];
    const before = buildConstellation(first).nodes;
    const after = buildConstellation([...first, dream("c", "2026-08-03", [])]).nodes.slice(0, 2);
    expect(after).toEqual(before);
  });
});

function dream(
  id: string,
  createdAt: string,
  motifs: ConstellationDream["motifs"],
): ConstellationDream {
  return { id, title: `Dream ${id}`, createdAt, motifs };
}

function date(index: number): string {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString();
}
