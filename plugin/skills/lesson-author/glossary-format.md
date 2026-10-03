# Glossary terms

The topic glossary, stored with `glossary_set`, is the one vocabulary of the workspace: lessons, items, cards and the tutor use its terms, so the learner meets one word per concept, the word the field uses.

```json
{
  "terms": [
    {
      "term": "Staging area",
      "definition": "The Git area where the contents of the next [[Commit|commit]] are assembled.",
      "avoid": ["buffer", "cache"]
    },
    { "term": "Commit", "definition": "A snapshot of the staging area saved in the repository." }
  ]
}
```

- `term` is the word practitioners use in the learner's language, written in that language. Where they use the English word ("pull request", "tool call"), that word is the term.
- `original` is the field's original term when `term` translates it, so the learner can read sources in either language; leave it out when `term` is already the original.
- `definition`: one or two sentences on what it is, not how to use it, in the learner's language. It may mark other glossary terms.
- `avoid` lists words for the same concept that the lessons do not use.
- Calling `glossary_set` with an existing term replaces its entry: refine a definition there when a later lesson sharpens it.
