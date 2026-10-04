import type { Database } from "bun:sqlite";
import type { Card, Item, Step } from "../../shared/schemas";

export const SOURCE_TEXT = `Git stores a project as a series of snapshots. Each commit records a snapshot of the staging area.
The git add command adds changes to the index. The index — the staging area — sits between the working tree and the repository.
The git commit command saves the contents of the index as a new commit. After a commit, the index matches the last commit.`;

export const QUOTE_EN = "Each commit records a snapshot of the staging area.";
export const QUOTE_ADD = "The git add command adds changes to the index.";

export function seedTopic(db: Database, topicId = "top_1"): { topicId: string; sourceId: string } {
  db.query("INSERT INTO topics (id, slug, title, request) VALUES (?, ?, ?, ?)").run(topicId, `slug-${topicId}`, "Git basics", "learn git");
  const sourceId = `src_${topicId}`;
  db.query("INSERT INTO sources (id, topic_id, url, title, kind, note, text, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')").run(
    sourceId,
    topicId,
    "https://example.org/git",
    "Git book",
    "docs",
    "Git internals overview",
    SOURCE_TEXT,
  );
  return { topicId, sourceId };
}

const common = (sourceId: string, nodeId = "git-index") => ({
  bloom: "apply" as const,
  solution: "git add puts the change into the index; git commit then records the index as a snapshot.",
  hints: ["Think about what the index holds.", "Which command moves changes into the index?"],
  cites: [{ sourceId, quote: QUOTE_ADD }],
  nodeId,
});

export function singleItem(sourceId = "src_top_1", overrides: Partial<Extract<Item, { format: "single" }>> = {}): Extract<Item, { format: "single" }> {
  return {
    format: "single",
    prompt: "You changed a file and want the edit to go into the next commit. What do you do first?",
    options: [
      { text: "Run git add on the file", feedback: "Right: the edit has to go into the index." },
      { text: "Run git push to the remote repository", misconception: "Confuses sending to the server with preparing a commit", feedback: "push sends commits that already exist." },
      { text: "Run git fetch from the remote repository", misconception: "Thinks fetch updates the index", feedback: "fetch only downloads other people's commits." },
    ],
    correct: 0,
    ...common(sourceId),
    ...overrides,
  };
}

export function orderItem(sourceId = "src_top_1"): Item {
  return {
    format: "order",
    prompt: "Put the steps of recording a change in order.",
    sequence: ["Edit the file", "Run git add", "Run git commit"],
    ...common(sourceId),
  };
}

export function clozeItem(sourceId = "src_top_1"): Item {
  return {
    format: "cloze",
    prompt: "Fill in the command names.",
    text: "First run {{1}} to stage, then {{2}} to record.",
    blanks: [["git add"], ["git commit"]],
    ...common(sourceId),
  };
}

export function activateStep(sourceId = "src_top_1"): Step {
  return {
    kind: "activate",
    title: "What you already know",
    items: [
      { ...singleItem(sourceId), bloom: "remember" },
      {
        format: "single",
        prompt: "Where does git keep the content of the next commit before you run git commit?",
        options: [
          { text: "In the index (staging area)", feedback: "Yes, the index holds the next snapshot." },
          { text: "In the remote repository", misconception: "Thinks commits are assembled on the server", feedback: "The remote only receives finished commits." },
          { text: "In the working tree only", misconception: "Does not know the index exists", feedback: "The working tree is separate from the index." },
        ],
        correct: 0,
        ...common(sourceId),
        bloom: "understand",
      },
    ],
  };
}

export function practiceStep(sourceId = "src_top_1", item: Item = singleItem(sourceId)): Step {
  return { kind: "practice", title: "Try it yourself", item };
}

export function explainStep(sourceId = "src_top_1", body = "The index holds the snapshot of the next commit. The git add command puts changes there."): Step {
  return {
    kind: "explain",
    title: "The index",
    body,
    cites: [{ sourceId, quote: QUOTE_EN }],
    checks: [clozeItem(sourceId)],
  };
}

export function card(sourceId = "src_top_1", overrides: Partial<Card> = {}): Card {
  return {
    kind: "basic",
    front: "Which git command adds changes to the index?",
    back: "git add",
    nodeId: "git-index",
    lens: "fact",
    cites: [{ sourceId, quote: QUOTE_ADD }],
    ...overrides,
  };
}

/** A one-page PDF with a Helvetica text line per entry and, optionally, an outline of top-level titles. */
export function pdfFile(lines: string[], outline: string[] = []): Uint8Array<ArrayBuffer> {
  const escape = (s: string) => s.replace(/[()\\]/g, "\\$&");
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${escape(l)}) '`).join(" ")} ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${outline.length ? " /Outlines 6 0 R" : ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (outline.length) {
    const first = objects.length + 2;
    objects.push(`<< /Type /Outlines /First ${first} 0 R /Last ${first + outline.length - 1} 0 R /Count ${outline.length} >>`);
    outline.forEach((title, i) => {
      const n = first + i;
      const links = `${i > 0 ? ` /Prev ${n - 1} 0 R` : ""}${i < outline.length - 1 ? ` /Next ${n + 1} 0 R` : ""}`;
      objects.push(`<< /Title (${escape(title)}) /Parent 6 0 R${links} /Dest [3 0 R /Fit] >>`);
    });
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
