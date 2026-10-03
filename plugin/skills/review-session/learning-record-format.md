# Learning record format

Learning records live in `learning-records/` as `0001-<dash-slug>.md`, numbered from the highest existing file plus one; create the directory with the first record. They hold evidence-grade facts about what the learner knows, the way decision records hold architecture decisions, and they steer the zone of proximal development. Write them in the learner's language.

```md
# {What was established}

{1–3 sentences: what the learner now knows, or which misconception was corrected or keeps returning, and what that changes for the next lessons.}

**Evidence**: {the attempt, placement answer or check result, with node id and date}
```

Add `Status: superseded by 000N` at the top of an older record when a newer one contradicts it; keep the old file.

A record needs evidence: a placement answer, a check passed, attempts that show a corrected or recurring misconception, or a shift in the mission. Material that was only covered, terms already in `GLOSSARY.md`, and session logs stay out.
