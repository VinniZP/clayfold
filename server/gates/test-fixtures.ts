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

export function matchItem(sourceId = "src_top_1"): Extract<Item, { format: "match" }> {
  return {
    format: "match",
    prompt: "Match each command to what it does.",
    pairs: [
      {
        left: "git add",
        right: "Puts a change into the index",
        mistake: { misconception: "Confuses staging a change with recording it", feedback: "This command prepares the next snapshot; nothing is recorded yet." },
      },
      { left: "git commit", right: "Records the index as a snapshot" },
      { left: "git status", right: "Lists staged and unstaged changes" },
    ],
    distractors: [{ text: "Sends commits to the remote", misconception: "Thinks a commit leaves the machine", feedback: "None of these commands talks to a server." }],
    ...common(sourceId),
  };
}

export function sortItem(sourceId = "src_top_1"): Extract<Item, { format: "sort" }> {
  return {
    format: "sort",
    prompt: "Where is each change right now?",
    categories: ["Working tree", "Index"],
    entries: [
      { text: "A file you just edited", category: 0, mistake: { misconception: "Thinks saving a file stages it", feedback: "Saving writes the file to disk; nothing has been added yet." } },
      { text: "A change after git add", category: 1 },
      { text: "A new file nobody added", category: 0 },
      { text: "A change ready for the next commit", category: 1 },
    ],
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
