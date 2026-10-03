# GLOSSARY.md format

`GLOSSARY.md` is the canonical language of the workspace: every lesson, item and card uses its terms, so the learner meets one word per concept.

```md
# Glossary: {Topic}

{One sentence on what the glossary covers.}

## {Group, when clusters emerge}

**Index** (staging area):
The Git area where the contents of the next commit are assembled.
_Avoid_: buffer, cache

**Commit**:
A snapshot of the index contents saved in the repository.
_Avoid_: save, version
```

- One or two sentences per term: what it is, not how to use it.
- Pick one word per concept and list the aliases to avoid; keep the original English term in parentheses where learners will meet it.
- Use glossary terms inside other definitions.
- Update a definition in place when a later lesson refines it.
