# Figures

A figure goes in an `explain` or `worked_example` step when the content has a structure, process, relationship or set of quantities that words carry poorly. A step without one is fine. *Decorative visuals and "interesting" details lower learning (g = −0.33 over 58 studies, Sundararajan & Adesope 2020).*

## Choose the kind (V5)

| Content | `kind` |
|---|---|
| Process, sequence, states, decisions | `mermaid` |
| Quantities: distributions, trends, comparisons of numbers | `chart` (Vega-Lite) |
| Structure or space: parts of a thing, layout, body position | `svg` |
| The learner changes a parameter and sees the effect, steps through a procedure, or watches motion | `widget` with `purpose` |

Static and stepwise is the default (V4). A widget earns its place only for motion, a procedure, or parameter play, and the learner drives it: no autoplay. *Animation helps mainly for motion and procedures (Höffler & Leutner 2007).*

## Every figure

- **V1** `teaches` states in one sentence the structure, process or relationship shown. Everything drawn serves that sentence: no backgrounds, icons, mascots, shadows or 3D. *Coherence principle, d = 0.86 (Mayer).*
- **V2** Labels sit inside the figure next to the part they name; no separate legend. Body text and figure sit in the same step. *Spatial contiguity, d = 1.10 (Mayer).*
- **V3** `caption` is optional and adds what the body does not say; it never repeats a body sentence.
- **V6** The figure parses and renders; its labels use the exact terms of the body text and the topic glossary, in the learner's language.
- `alt` describes the content fully enough to learn from without the picture.

## mermaid

`flowchart LR|TD`, `sequenceDiagram` or `stateDiagram-v2`, at most 12 nodes, actions as edge labels. Quote labels with punctuation: `A["git add ."]`. No `style`, `classDef` or `%%{init}%%` lines: the platform themes diagrams.

## svg

- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">` with W between 600 and 720; no `width`/`height` attributes, so it scales.
- Colour: `var(--fig-1)` … `var(--fig-6)` for fills and strokes of the parts; `currentColor` for text, axes and connector lines. These follow the light and dark themes; literal colours do not.
- Text: `font-family="inherit"`, `font-size` 14–16, `text-anchor` set explicitly.
- A `<title>` element; no `<script>`, event attributes, `<foreignObject>`, external `href` or embedded images (the sanitiser removes them).

## chart

A Vega-Lite spec with inline `data.values` (no URLs), `"width"` 600–720, axis titles with units in the learner's language. Leave colours to the platform's theme. Label series directly with a layered `text` mark at the line ends instead of a legend (V2): set `"legend": null` on the colour channel.

## widget

Self-contained HTML: inline CSS and JS, no network (no CDN, no `fetch`), fits 600–720 px wide, operable by keyboard. Controls (slider, buttons, step-through) belong to the learner. Colours `var(--fig-1, #2563eb)` with a fallback. `purpose` is `motion`, `procedure` or `parameter`.

## Examples

```json
{
  "kind": "mermaid",
  "code": "flowchart LR\n  W[Working directory] -->|git add| I[Index]\n  I -->|git commit| R[Repository]",
  "teaches": "The path of a change through Git's three areas and the commands that move it between them.",
  "alt": "Diagram: working directory, an arrow labelled git add to the index, an arrow labelled git commit to the repository."
}
```

```json
{
  "kind": "svg",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 200\" font-family=\"inherit\" font-size=\"15\"><title>Git's three areas</title><rect x=\"20\" y=\"60\" width=\"170\" height=\"80\" rx=\"8\" fill=\"var(--fig-1)\" fill-opacity=\"0.18\" stroke=\"var(--fig-1)\"/><text x=\"105\" y=\"105\" text-anchor=\"middle\" fill=\"currentColor\">Working directory</text><rect x=\"235\" y=\"60\" width=\"170\" height=\"80\" rx=\"8\" fill=\"var(--fig-2)\" fill-opacity=\"0.18\" stroke=\"var(--fig-2)\"/><text x=\"320\" y=\"105\" text-anchor=\"middle\" fill=\"currentColor\">Index</text><rect x=\"450\" y=\"60\" width=\"170\" height=\"80\" rx=\"8\" fill=\"var(--fig-3)\" fill-opacity=\"0.18\" stroke=\"var(--fig-3)\"/><text x=\"535\" y=\"105\" text-anchor=\"middle\" fill=\"currentColor\">Repository</text><path d=\"M190 100 H229 M405 100 H444\" stroke=\"currentColor\" stroke-width=\"2\"/><text x=\"212\" y=\"50\" text-anchor=\"middle\" fill=\"currentColor\">git add</text><text x=\"427\" y=\"50\" text-anchor=\"middle\" fill=\"currentColor\">git commit</text></svg>",
  "teaches": "Git's three areas stand in order, and each command moves a change into the next one.",
  "alt": "Three rectangles from left to right: working directory, index, repository. Between the first and second the label git add, between the second and third the label git commit."
}
```

```json
{
  "kind": "chart",
  "spec": {
    "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
    "width": 640,
    "height": 260,
    "data": { "values": [
      { "p": 0.1, "posterior": 0.02 }, { "p": 0.3, "posterior": 0.21 }, { "p": 0.5, "posterior": 0.38 },
      { "p": 0.7, "posterior": 0.29 }, { "p": 0.9, "posterior": 0.1 }
    ] },
    "mark": { "type": "line", "point": true },
    "encoding": {
      "x": { "field": "p", "type": "quantitative", "title": "Success rate p" },
      "y": { "field": "posterior", "type": "quantitative", "title": "Posterior probability" }
    }
  },
  "teaches": "The posterior distribution of the success rate concentrates around the observed rate.",
  "alt": "A line peaking near p = 0.5: the probability rises from 0.02 at p = 0.1 to 0.38 at p = 0.5 and falls to 0.1 at p = 0.9."
}
```

```json
{
  "kind": "widget",
  "purpose": "procedure",
  "html": "<div style=\"font-family:inherit;max-width:640px\"><p id=\"s\" aria-live=\"polite\">Step 1 of 3: lie on your back, knees bent, feet on the floor.</p><button id=\"b\">Next step</button><script>const t=['Step 1 of 3: lie on your back, knees bent, feet on the floor.','Step 2 of 3: hold one knee with both hands and gently pull it toward your chest.','Step 3 of 3: hold for 20–30 seconds, breathe calmly, then switch legs.'];let i=0;document.getElementById('b').onclick=()=>{i=(i+1)%t.length;document.getElementById('s').textContent=t[i];};</script></div>",
  "teaches": "The knee-to-chest exercise as a sequence of steps the learner steps through themselves.",
  "alt": "A three-step instruction with a Next step button: lying position, pulling the knee in, holding and switching legs."
}
```
