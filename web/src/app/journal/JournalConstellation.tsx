import type { ReactElement } from "react";
import type { ConstellationDream, ConstellationNode } from "@/lib/domain/constellation";
import { buildConstellation } from "@/lib/domain/constellation";

const BASE_EDGE_WIDTH = 1.5;
const EDGE_WIDTH_STEP = 1;
const MAX_EDGE_WIDTH = 4.5;

interface JournalConstellationProps {
  readonly dreams: readonly ConstellationDream[];
}

export function JournalConstellation({ dreams }: JournalConstellationProps): ReactElement {
  const graph = buildConstellation(dreams);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <section aria-labelledby="constellation-title" className="constellation-panel">
      <header><p className="eyebrow">Patterns</p><h2 id="constellation-title">What keeps returning</h2>
        <p>Shared people, places, and symbols connect the dreams where they appear.</p></header>
      {graph.nodes.length ? <ConstellationMap graph={graph} nodes={nodes} /> : <p className="constellation-empty">Patterns will appear as you add dreams to your journal.</p>}
    </section>
  );
}

function ConstellationMap({ graph, nodes }: {
  readonly graph: ReturnType<typeof buildConstellation>;
  readonly nodes: ReadonlyMap<string, ConstellationNode>;
}): ReactElement {
  return <><svg aria-labelledby="constellation-map-title constellation-description" className="constellation-map" role="group" viewBox="0 0 1000 640">
    <title id="constellation-map-title">Dreams connected by recurring motifs</title>
    <desc id="constellation-description">Each star is a completed dream. Lines connect dreams that share a recurring motif.</desc>
    {graph.edges.map((edge) => <ConstellationLine edge={edge} key={edge.id} nodes={nodes} />)}
    {graph.nodes.map((node) => <ConstellationStar key={node.id} node={node} />)}
  </svg><MotifLegend graph={graph} nodes={nodes} /></>;
}

function ConstellationLine({ edge, nodes }: {
  readonly edge: ReturnType<typeof buildConstellation>["edges"][number];
  readonly nodes: ReadonlyMap<string, ConstellationNode>;
}): ReactElement | null {
  const source = nodes.get(edge.sourceId);
  const target = nodes.get(edge.targetId);
  if (!source || !target) return null;
  return <line className="constellation-line" strokeWidth={edgeWidth(edge.weight)} x1={source.x} x2={target.x}
    y1={source.y} y2={target.y}><title>{edge.motifs.join(", ")}</title></line>;
}

function ConstellationStar({ node }: { readonly node: ConstellationNode }): ReactElement {
  const rightAligned = node.x > 760;
  return <a aria-label={`Open ${node.title}`} className="constellation-star" href={`/dream/${node.id}`}>
    <circle className="constellation-hit" cx={node.x} cy={node.y} r="24" />
    <circle className="constellation-dot" cx={node.x} cy={node.y} r="7" />
    <text textAnchor={rightAligned ? "end" : "start"} x={node.x + (rightAligned ? -13 : 13)}
      y={node.y - 13}>{shortTitle(node.title)}</text>
  </a>;
}

function MotifLegend({ graph, nodes }: {
  readonly graph: ReturnType<typeof buildConstellation>;
  readonly nodes: ReadonlyMap<string, ConstellationNode>;
}): ReactElement {
  if (!graph.recurringMotifs.length) return <p className="constellation-empty">A pattern will appear when something returns in another dream.</p>;
  return <><ul aria-label="Recurring motif legend" className="motif-legend">{graph.recurringMotifs.map((motif) =>
    <li key={motif.slug}><span aria-hidden="true" />{motif.label} · {motif.count} dreams</li>)}</ul>
    <ul className="sr-only">{graph.edges.map((edge) => <li key={edge.id}>
      {nodes.get(edge.sourceId)?.title} connects to {nodes.get(edge.targetId)?.title} through {edge.motifs.join(", ")}
    </li>)}</ul></>;
}

function shortTitle(title: string): string {
  const maximumLength = 26;
  return title.length <= maximumLength ? title : `${title.slice(0, maximumLength - 1)}…`;
}

function edgeWidth(weight: number): number {
  return Math.min(MAX_EDGE_WIDTH, BASE_EDGE_WIDTH + ((weight - 1) * EDGE_WIDTH_STEP));
}
