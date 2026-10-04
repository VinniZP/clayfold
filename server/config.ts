import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

export const config = {
  root,
  port: Number(process.env.CLAYFOLD_PORT ?? 4317),
  dataDir: resolve(process.env.CLAYFOLD_DATA_DIR ?? `${root}/data`),
  pluginDir: resolve(`${root}/plugin`),
  /** Model for onboarding, lesson authoring and tutoring. */
  model: process.env.CLAYFOLD_MODEL ?? "opus",
  /** Model for the critic. It differs from `model`: LLM judges rate their own outputs higher (Panickssery et al., NeurIPS 2024). */
  criticModel: process.env.CLAYFOLD_CRITIC_MODEL ?? "sonnet",
  /** Spend ceiling per claude run, passed as --max-budget-usd. */
  maxBudgetUsd: Number(process.env.CLAYFOLD_MAX_BUDGET_USD ?? 5),
  claudeBin: process.env.CLAYFOLD_CLAUDE_BIN ?? "claude",
};

export const paths = {
  db: `${config.dataDir}/clayfold.sqlite`,
  workspaces: `${config.dataDir}/workspaces`,
  workspace: (slug: string) => `${config.dataDir}/workspaces/${slug}`,
  /** Lesson videos rendered to MP4. */
  exports: `${config.dataDir}/exports`,
};
