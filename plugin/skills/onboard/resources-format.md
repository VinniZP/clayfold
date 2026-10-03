# RESOURCES.md format

`RESOURCES.md` lists the registered sources. Lesson authoring reads the `sourceId` values from here to call `source_search`, so every registered source carries its id.

```md
# Sources: {Topic}

## Knowledge

- [Pro Git, chapter 2 "Git Basics"](https://git-scm.com/book/en/v2/...) — `sourceId: src_abc123`, docs · vendor-official · git-scm.com
  Core commands: init, add, commit, log. For nodes: git-init, staging, commit.
- [Julia Evans, "Inside .git"](https://jvns.ca/...) — `sourceId: src_def456`, article · independent-practitioner · Julia Evans
  How objects and the index work inside. For nodes: staging, commit.

## Coverage

| Success criterion | Sources (different publishers) |
|---|---|
| {criterion from MISSION.md} | `src_abc123` (git-scm.com), `src_def456` (Julia Evans) |

## Communities

- [Name](https://...) — where to ask practitioners. For: reviewing mistakes, feedback.

## Gaps

- {A success criterion with fewer than 2 sources from different publishers, or an area no registered source covers yet}
```

- Every entry: link, `sourceId`, kind, perspective, publisher, and one annotation line (what it covers, which graph nodes it serves).
- Perspective is one of `vendor-official` (the maker of the product described), `independent-practitioner`, `academic`, `course`, `community`. Publisher is the organisation or the person behind the page.
- `## Coverage` maps each success criterion in `MISSION.md` to at least 2 sources from different publishers; a criterion short of that goes under `## Gaps`.
- High-trust only: primary sources, recognised practitioners and researchers, institutions. Marketing dressed as education stays out.
- Communities are optional suggestions for real-world practice; they are not registered with `source_add`.
- When a source proves wrong or shallow, remove it rather than burying it.
