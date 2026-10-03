---
arm: both
type: llm
focus: mock_calls
---
Judge only the graph_set call.
PASS if all hold: it has between 6 and 25 nodes; every id in any prereqs list is the id of a node in the same call; no node lists itself as a prereq; there is at least one node about the beta-binomial model or Bayesian A/B testing of conversion rates; titles are in English.
FAIL if there is no graph_set call or any condition above does not hold.
