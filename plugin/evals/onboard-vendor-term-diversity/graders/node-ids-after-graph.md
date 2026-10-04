---
arm: both
type: llm
focus: mock_calls
---
PASS if every source_add call made after the graph_set call has a nodeIds list naming only ids of nodes in that graph_set call. PASS as well when no source_add call follows graph_set.
FAIL if a source_add call after graph_set lacks nodeIds or names an id that is not a node of the graph.
