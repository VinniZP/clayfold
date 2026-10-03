---
type: llm
focus: mock_calls
arm: both
---
Judge only the cards_propose call.
PASS if all hold: it proposes 3 to 8 cards; every card's back holds one answer (no list of several items; a difference card that names both sides of one contrast is one answer); no front can be answered with yes or no; no front asks about two things at once; at least two different "lens" values are used.
FAIL if there is no cards_propose call or any condition above does not hold.
