"use client";

import type { ReactElement } from "react";
import type { VisualStyle } from "@/lib/domain/identity";

const STYLES: readonly {
  readonly id: VisualStyle;
  readonly name: string;
  readonly description: string;
}[] = [
  { id: "dream-cinema", name: "Dream cinema", description: "Luminous, painterly, and emotionally grounded" },
  { id: "watercolor-memory", name: "Watercolor memory", description: "Soft washes, pencil detail, and handmade warmth" },
  { id: "graphic-surreal", name: "Graphic surreal", description: "Bold symbols, rich color, and editorial shapes" },
];

export function StoryStylePicker({
  value,
  onChange,
}: {
  readonly value: VisualStyle;
  readonly onChange: (style: VisualStyle) => void;
}): ReactElement {
  return <fieldset className="style-picker"><legend>How should it feel?</legend>
    <div className="style-options">{STYLES.map((style) => <label key={style.id}
      className={value === style.id ? "style-option selected" : "style-option"}>
      <input checked={value === style.id} name="visual-style"
        onChange={() => onChange(style.id)} type="radio" value={style.id} />
      <span><strong>{style.name}</strong><small>{style.description}</small></span>
    </label>)}</div>
  </fieldset>;
}
