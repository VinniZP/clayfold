---
type: llm
focus: mock_calls
arm: both
---
Judge only the source_add calls whose answer has "ok":true. Determine each source's publisher from its URL (the organisation or person behind the site).
PASS if all hold: the sources come from at least 4 distinct publishers; no single publisher accounts for more than 40% of them; at least one third are independent, meaning the publisher does not sell the product or model the page describes (independent practitioners' blogs, academic papers, courses and journalists count; a vendor's own docs or engineering blog about its own product does not).
FAIL otherwise.
