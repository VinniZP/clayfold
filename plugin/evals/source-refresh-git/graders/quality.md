---
arm: both
type: llm
focus: mock_calls
---
Judge the sources registered with source_add.
PASS if all hold: each URL is an HTML page, PDF or text file that teaches its subject itself (official documentation, a book, a course, a recognised practitioner's article, a paper), not a forum thread, a video page, a social post or an SEO listicle; at least one new source comes from a publisher other than git-scm.com.
FAIL otherwise; name the source.
