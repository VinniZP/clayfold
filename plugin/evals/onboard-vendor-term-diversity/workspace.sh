#!/bin/bash
set -e
cat > MISSION.md <<'MD'
# Mission: AI harness engineering

## Why
Design and launch an LLM support agent at my company: the tool-calling loop, context management, quality checks and error protection, so that it works reliably in production and not just in a demo.

## Success means
- I design the agent loop: tools, their descriptions, error handling and stopping, and I explain the choices in a review.
- I manage the context of a long session: what to keep in the window, what to compress, what to move to memory.
- I build a set of evals for the agent and use it to compare two versions of a prompt or model.
- I set guardrails: tool permissions, confirmation of dangerous actions, budget.

## Constraints
- 5 hours a week, a 3-month deadline.
- The model provider is not chosen yet: I need an overview of different vendors' approaches.

## Already know
- 6 years of backend in Python; built a RAG bot on a single API; have not built agents with tools.

## Interests and context
- Customer support for an online store, tickets, CRM integrations.

## Out of scope
- Training and fine-tuning models.
MD
printf '# Notes\n- Prefers an informal tone.\n- Wants independent opinions, not only vendor documentation.\n' > NOTES.md
