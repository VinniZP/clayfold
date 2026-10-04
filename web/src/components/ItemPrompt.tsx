import * as stylex from "@stylexjs/stylex";
import { color, font, reading, space } from "../theme/tokens.stylex";
import { layout } from "../theme/ui";
import { parsePrompt, type Block } from "../lib/prompt";
import { Markdown } from "./ui";

const s = stylex.create({
  prompt: { display: "grid", gap: space.md, maxWidth: reading.measure, minWidth: 0 },
  scenario: { display: "grid", gap: space.md, fontSize: `calc(16px * ${reading.scale})`, lineHeight: reading.leading, color: color.text },
  only: { fontSize: `calc(17px * ${reading.scale})`, fontWeight: 500 },
  parts: { display: "grid", gap: space.sm, margin: 0, padding: 0, listStyle: "none" },
  part: { display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: space.md, alignItems: "start" },
  label: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: color.lilacSoft,
    color: color.accentText,
    fontFamily: font.display,
    fontSize: 14,
    fontWeight: 700,
  },
  partText: { paddingTop: 2 },
  question: {
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.border,
    fontSize: `calc(18px * ${reading.scale})`,
    fontWeight: 650,
    lineHeight: 1.45,
  },
});

function PartsList({ block }: { block: Extract<Block, { kind: "parts" }> }) {
  return (
    <>
      {block.intro && <Markdown src={block.intro} />}
      <ul {...stylex.props(s.parts)}>
        {block.parts.map((p) => (
          <li key={p.label} {...stylex.props(s.part)}>
            <span aria-hidden="true" {...stylex.props(s.label)}>
              {p.label}
            </span>
            <span {...stylex.props(s.partText)}>
              <span {...stylex.props(layout.srOnly)}>({p.label}) </span>
              <Markdown src={p.text} inline />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** An item prompt laid out as scenario, labelled parts and the question line. */
export function ItemPrompt({ src, id }: { src: string; id?: string }) {
  const { scenario, question } = parsePrompt(src);
  const simple = !question && scenario.length === 1 && scenario[0]!.kind === "md";
  return (
    <div id={id} {...stylex.props(s.prompt)}>
      {simple ? (
        <Markdown src={src} xstyle={s.only} />
      ) : (
        <div {...stylex.props(s.scenario)}>
          {scenario.map((b, i) => (b.kind === "md" ? <Markdown key={i} src={b.src} /> : <PartsList key={i} block={b} />))}
        </div>
      )}
      {question && <Markdown src={question} xstyle={s.question} />}
    </div>
  );
}
