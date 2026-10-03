import { expect, test } from "bun:test";
import { openDb } from "./db";
import { publisherCounts, publisherOf } from "./publishers";

test("publisherOf maps domains to organisations", () => {
  const cases: [string, string][] = [
    ["https://www.anthropic.com/engineering/building-effective-agents", "Anthropic"],
    ["https://docs.anthropic.com/en/docs", "Anthropic"],
    ["https://docs.claude.com/en/docs/agents", "Anthropic"],
    ["https://claude.com/blog", "Anthropic"],
    ["https://platform.openai.com/docs", "OpenAI"],
    ["https://openai.github.io/openai-agents-python/", "OpenAI"],
    ["https://ai.google.dev/gemini-api/docs", "Google"],
    ["https://deepmind.google/research", "Google"],
    ["https://cloud.google.com/vertex-ai", "Google"],
    ["https://github.com/langchain-ai/langgraph", "langchain-ai"],
    ["https://karpathy.github.io/2015/05/21/rnn-effectiveness/", "karpathy"],
    ["https://en.wikipedia.org/wiki/Git", "wikipedia"],
    ["https://www.bbc.co.uk/news", "bbc"],
    ["https://git-scm.com/book/ru/v2", "git-scm"],
    ["https://www.nhs.uk/live-well/exercise/", "nhs"],
  ];
  for (const [url, publisher] of cases) expect([url, publisherOf(url)]).toEqual([url, publisher]);
});

test("publisherCounts counts only ok sources of the topic", () => {
  const database = openDb(":memory:");
  database.query("INSERT INTO topics (id, slug, title, request) VALUES ('t', 't', 't', 'r')").run();
  const add = database.query("INSERT INTO sources (id, topic_id, url, title, kind, note, status) VALUES (?, 't', ?, 'x', 'docs', 'n', ?)");
  add.run("s1", "https://docs.anthropic.com/a", "ok");
  add.run("s2", "https://www.anthropic.com/b", "ok");
  add.run("s3", "https://git-scm.com/book", "ok");
  add.run("s4", "https://example.org/x.pdf", "failed");
  expect(publisherCounts("t", database)).toEqual({ Anthropic: 2, "git-scm": 1 });
});
