---
arm: both
type: llm
focus: mock_calls
---
Judge the calls made after the graph_set call (phase 5 of the onboard skill: sources per node).
PASS if, for most nodes of the graph_set call, a later source_search call queries that node's subject, or a later source_add call names the node in nodeIds.
FAIL if there is no graph_set call, or the calls after it check fewer than half of the nodes.
