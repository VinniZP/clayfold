import { describe, expect, test } from "bun:test";
import { checkChart, checkMermaid, checkSvg, checkWidget } from "./figures";

describe("V6 mermaid", () => {
  test("valid flowchart parses", async () => {
    expect(await checkMermaid("flowchart LR\n  A[Working tree] -->|git add| B[Index]\n  B -->|git commit| C[(Repository)]", "figure")).toEqual([]);
  });
  test("valid sequence and state diagrams parse", async () => {
    expect(await checkMermaid("sequenceDiagram\n  Client->>Server: GET /\n  Server-->>Client: 200", "figure")).toEqual([]);
    expect(await checkMermaid("stateDiagram-v2\n  [*] --> Modified\n  Modified --> Staged: git add", "figure")).toEqual([]);
  });
  test("broken flowchart is rejected", async () => {
    const v = await checkMermaid("flowchart TD\n  A[Start --> B{{", "figure");
    expect(v).toEqual([expect.objectContaining({ rule: "V6", path: "figure.code" })]);
    expect(v[0]!.message).toContain("Parse error");
  });
  test("unknown diagram type is rejected", async () => {
    expect((await checkMermaid("diagramm\n A --> B", "figure")).length).toBe(1);
  });
  test("parsing leaves no DOM globals behind", async () => {
    await checkMermaid("flowchart LR\n A --> B", "figure");
    expect("window" in globalThis).toBe(false);
    expect("document" in globalThis).toBe(false);
  });
});

const svg = (inner: string, attrs = 'viewBox="0 0 200 100"') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`;
const GOOD = svg(
  '<defs><marker id="arrow" markerWidth="6" markerHeight="6"><path d="M0,0 L6,3 L0,6 z"/></marker></defs>' +
    '<rect x="10" y="10" width="60" height="30" fill="#eee"/><text x="15" y="30">Index</text>' +
    '<line x1="70" y1="25" x2="120" y2="25" stroke="#333" marker-end="url(#arrow)"/><text x="125" y="30">Commit</text>',
);

describe("V6 svg", () => {
  test("good svg passes", () => expect(checkSvg(GOOD, "figure")).toEqual([]));
  test("malformed XML", () => expect(checkSvg(svg("<text>a</g>"), "figure")[0]!.message).toContain("well-formed"));
  test("wrong root", () => expect(checkSvg('<g xmlns="http://www.w3.org/2000/svg"><text>a</text></g>', "figure")[0]!.message).toContain("root"));
  test("no viewBox", () => expect(checkSvg(svg("<text>a</text>", 'width="10"'), "figure")[0]!.message).toContain("viewBox"));
  test("no text", () => expect(checkSvg(svg('<rect width="1" height="1"/>'), "figure")[0]!.message).toContain("<text>"));
  test("script", () => expect(checkSvg(svg("<text>a</text><script>alert(1)</script>"), "figure").map((v) => v.message).join()).toContain("<script>"));
  test("foreignObject", () => expect(checkSvg(svg("<text>a</text><foreignObject><div>x</div></foreignObject>"), "figure").length).toBeGreaterThan(0));
  test("event handler attribute", () => expect(checkSvg(svg('<text onclick="x()">a</text>'), "figure")[0]!.message).toContain("onclick"));
  test("external href", () => {
    expect(checkSvg(svg('<text>a</text><image href="https://example.org/a.png" width="1" height="1"/>'), "figure")[0]!.message).toContain("same-document");
    expect(checkSvg(svg('<a xlink:href="javascript:alert(1)"><text>a</text></a>'), "figure").length).toBe(1);
  });
  test("same-document href is allowed", () => expect(checkSvg(svg('<text><textPath href="#p">a</textPath></text><path id="p" d="M0 0"/>'), "figure")).toEqual([]));
  test("element the sanitizer removes", () => {
    const v = checkSvg(svg('<text>a</text><use href="#x"/><circle id="x" r="1"/>'), "figure");
    expect(v[0]!.message).toContain("<use>");
  });
});

describe("V6 chart", () => {
  const spec = {
    data: { values: [{ x: "add", y: 3 }, { x: "commit", y: 5 }] },
    mark: "bar",
    encoding: { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } },
  };
  test("inline bar chart compiles", async () => expect(await checkChart(spec, "figure")).toEqual([]));
  test("url data source", async () => {
    expect(await checkChart({ ...spec, data: { url: "https://example.org/d.csv" } }, "figure")).toContainEqual(expect.objectContaining({ path: "figure.spec.data" }));
  });
  test("url in a layer", async () => {
    const layered = { layer: [{ ...spec }, { ...spec, data: { url: "d.json" } }] };
    expect((await checkChart(layered, "figure")).map((v) => v.path)).toContain("figure.spec.layer.1.data");
  });
  test("no data", async () => expect((await checkChart({ mark: "bar" }, "figure"))[0]!.message).toContain("inline"));
  test("invalid spec does not compile", async () => {
    const bad = { ...spec, encoding: { x: { field: "x", type: "nonsense" } } };
    expect((await checkChart(bad, "figure"))[0]!.message).toContain("does not compile");
  });
});

describe("V6 widget", () => {
  const ok = '<div id="w"></div><input type="range" oninput="draw(this.value)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg><script>function draw(v){document.getElementById("w").textContent=v}</script>';
  test("self-contained widget passes", () => expect(checkWidget(ok, "figure")).toEqual([]));
  test("network URL", () => expect(checkWidget(`${ok}<script src="https://cdn.example.org/x.js"></script>`, "figure").length).toBe(1));
  test("forbidden APIs", () => {
    for (const code of ["fetch('/x')", "new XMLHttpRequest()", "new WebSocket('ws://x')", "import('./m.js')", "eval('1')", "new Function('return 1')"]) {
      expect(checkWidget(`${ok}<script>${code}</script>`, "figure").length).toBeGreaterThan(0);
    }
  });
  test("over 60 KB", () => expect(checkWidget(ok + " ".repeat(61 * 1024), "figure")[0]!.message).toContain("60 KB"));
});
