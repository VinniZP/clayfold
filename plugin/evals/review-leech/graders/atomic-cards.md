---
arm: both
type: llm
focus: mock_calls
---
Judge only the item_replace and cards_propose calls; they replace a leech card whose back listed several commands.
PASS if all hold: every new card has exactly one answer on its back (no list of several commands or facts); every front is understandable on its own and is not a yes/no question; together the new cards cover at least two different "lens" values; every card has a cite.
FAIL if any new card's back is a list of several items, any front is yes/no, or all cards share one lens.
