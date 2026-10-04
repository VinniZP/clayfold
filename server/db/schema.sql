-- Owner column: A = server core (routes, runner, review), B = quality + MCP (gates, tools).
-- Every module may read any table; it writes only the tables its owner letter marks.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topics (            -- A
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL DEFAULT 'topic' CHECK (kind IN ('topic','goal')),
  goal_id TEXT REFERENCES topics(id) ON DELETE SET NULL  -- the goal whose plan opened this topic
);

CREATE TABLE IF NOT EXISTS goal_plan (         -- B writes entries; A sets topic_id when the learner opens one
  goal_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  brief TEXT NOT NULL,                          -- request passed to /clayfold:onboard when the topic is opened
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  PRIMARY KEY (goal_id, id)
);

CREATE TABLE IF NOT EXISTS conversations (     -- A
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('onboard','lesson','tutor','review')),
  lesson_id TEXT,
  session_id TEXT,                              -- Claude Code session for --resume
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (          -- A
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','activity','ask','error')),
  text TEXT NOT NULL,
  meta TEXT,                                    -- JSON: ask options, tool name, cost
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS nodes (             -- B writes graph; A writes mastery columns
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  prereqs TEXT NOT NULL,                        -- JSON array of node ids
  placement TEXT CHECK (placement IN ('known','partial','unknown')),
  placement_evidence TEXT,
  mastery TEXT NOT NULL DEFAULT 'new' CHECK (mastery IN ('new','learning','exit_passed','mastered')),
  exit_passed_at TEXT,
  mastered_at TEXT,
  PRIMARY KEY (topic_id, id)
);

CREATE TABLE IF NOT EXISTS sources (           -- B (A adds and removes learner materials through gates/materials.ts)
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  url TEXT NOT NULL,                            -- learner file or pasted text: material:<id>
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- web: genre from source_add; learner: MaterialKind
  note TEXT NOT NULL,
  text TEXT,                                    -- extracted readable text; quotes are verified against it
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  error TEXT,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  origin TEXT NOT NULL DEFAULT 'web' CHECK (origin IN ('web','learner')),
  bytes INTEGER,                                -- learner file or pasted text: its size
  headings TEXT,                                -- learner: JSON [{text, offset}] into text
  UNIQUE (topic_id, url)
);

CREATE TABLE IF NOT EXISTS lessons (           -- B (A creates practice sets and sets status 'failed' when a run dies)
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  level TEXT NOT NULL,
  node_ids TEXT NOT NULL,                       -- JSON
  outline TEXT NOT NULL,                        -- JSON [{kind,title}]
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','finished','failed')),
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  planned_sources TEXT,                         -- JSON source ids from lesson_plan (Q8)
  sources_at_plan INTEGER,                      -- ok sources of the topic when the lesson was planned
  announced_sources TEXT,                       -- JSON source ids the lesson author has been told about
  challenge_idx INTEGER,                        -- outline index of the challenge step (gamification, G1)
  practice TEXT                                 -- JSON {focus, seedItemId} for a practice set; NULL for a lesson
);

CREATE TABLE IF NOT EXISTS steps (             -- B
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,                        -- JSON authoring Step (keys included)
  status TEXT NOT NULL CHECK (status IN ('checking','published','rejected','dropped')),
  attempts INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  UNIQUE (lesson_id, idx)
);

CREATE TABLE IF NOT EXISTS items (             -- B inserts on publish; A updates status
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  lesson_id TEXT,
  step_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('activate','check','practice','explain_check','review')),
  node_id TEXT NOT NULL,
  format TEXT NOT NULL,
  content TEXT NOT NULL,                        -- JSON authoring Item
  display_order TEXT,                           -- JSON permutation for options/entries (Q3); match: left, then right
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','flagged','retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attempts (          -- A
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,                         -- JSON Answer
  correct INTEGER,                              -- NULL: ungraded or pending
  chosen_option INTEGER,                        -- authoring index for single choice
  misconception TEXT,
  hints_used INTEGER NOT NULL DEFAULT 0,
  gave_up INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confidence TEXT CHECK (confidence IN ('guess','unsure','sure'))  -- learner's rating before the check (L20)
);

CREATE TABLE IF NOT EXISTS cards (             -- B inserts proposals; A owns review state
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  lesson_id TEXT,
  node_id TEXT NOT NULL,
  content TEXT NOT NULL,                        -- JSON Card
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','suspended','rejected')),
  fsrs TEXT,                                    -- JSON ts-fsrs Card state
  due TEXT,
  lapses INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reviews (           -- A
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  log TEXT NOT NULL,                            -- JSON ts-fsrs ReviewLog
  duration_ms INTEGER,
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notes (             -- A
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  lesson_id TEXT,
  step_id TEXT,
  quote TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS gate_results (      -- B
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('step','item','card')),
  target_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('schema','deterministic','quotes','critic')),
  rule TEXT NOT NULL,
  pass INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS glossary_terms (    -- B via glossary_set
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  key TEXT NOT NULL,                            -- lowercased term; term marks resolve against it
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  original TEXT,                                -- the field's original term, usually English
  avoid TEXT NOT NULL DEFAULT '[]',             -- JSON array of words not to use for this concept
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (topic_id, key)
);

CREATE TABLE IF NOT EXISTS goal_notes (        -- B inserts via goal_note; A sets seen_at when the goal conversation receives them
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  seen_at TEXT
);

CREATE TABLE IF NOT EXISTS regen_queue (       -- A enqueues from learner signals; B resolves via item_replace
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('item','card')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  signal TEXT,                                  -- JSON evidence
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reports (           -- A
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audits (            -- A
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('ok','missed_defect')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (          -- A
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                           -- JSON
);

CREATE TABLE IF NOT EXISTS narrations (        -- A
  step_id TEXT PRIMARY KEY REFERENCES steps(id) ON DELETE CASCADE,
  voice_id TEXT NOT NULL,
  model TEXT NOT NULL,
  segments TEXT NOT NULL,                       -- JSON NarrationSegment[]
  audio BLOB NOT NULL,                          -- audio/mpeg
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS videos (            -- A
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('building','ready','failed')),
  timeline TEXT,                                -- JSON VideoTimeline when ready
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS video_clips (       -- A
  lesson_id TEXT NOT NULL REFERENCES videos(lesson_id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  audio BLOB NOT NULL,                          -- audio/mpeg
  PRIMARY KEY (lesson_id, idx)
);

CREATE TABLE IF NOT EXISTS alternatives (      -- A
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  lens TEXT NOT NULL,                           -- ExplainLens
  body TEXT NOT NULL,                           -- Markdown; term marks name terms of the topic glossary
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS hint_views (        -- A
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,                       -- 1-based rung of the item's hint ladder
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS worked_answers (    -- A
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  line_idx INTEGER NOT NULL,
  answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Meerkat (gamification, off by default): shared/game.ts.

CREATE TABLE IF NOT EXISTS rewards (           -- B inserts via lesson_plan, graph_set and goal_plan_set; A sets unlocked_at and seen_at
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,  -- the course or goal that designed it
  source TEXT NOT NULL CHECK (source IN ('lesson','course','stage')),
  ref TEXT NOT NULL,                            -- lesson id, milestone key or stage name
  condition TEXT NOT NULL,                      -- JSON RewardCondition
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  slot TEXT NOT NULL,
  svg TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unlocked_at TEXT,
  seen_at TEXT,
  UNIQUE (topic_id, source, ref)
);

CREATE TABLE IF NOT EXISTS residents (         -- B inserts via graph_set; A sets befriended_at and seen_at
  topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  content TEXT NOT NULL,                        -- JSON Resident
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  befriended_at TEXT,
  seen_at TEXT
);

CREATE TABLE IF NOT EXISTS unlocks (           -- A
  id TEXT PRIMARY KEY,                          -- a HABITS id, or rank:<n>
  unlocked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  seen_at TEXT
);

CREATE TABLE IF NOT EXISTS focus_runs (        -- A
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  longest_away_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS retries (           -- A; mistakes-notebook retries, kept out of attempts (L20)
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,                         -- JSON Answer
  correct INTEGER NOT NULL,
  chosen_option INTEGER,                        -- authoring index for single choice
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS practice_tests (    -- A
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,  -- a topic, or a goal: the test then spans the goal's topics
  kind TEXT NOT NULL DEFAULT 'practice' CHECK (kind IN ('practice','final')),  -- final: the closing test of a completed topic
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','grading','done')),
  time_limit_min INTEGER,                       -- NULL: untimed
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS practice_test_items ( -- A
  test_id TEXT NOT NULL REFERENCES practice_tests(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  item_id TEXT NOT NULL,                        -- items.id; content and display order are copies, so item_replace leaves a test as taken
  topic_id TEXT NOT NULL,
  lesson_id TEXT,
  node_id TEXT NOT NULL,
  content TEXT NOT NULL,                        -- JSON authoring Item
  display_order TEXT,
  answer TEXT,                                  -- JSON Answer; NULL while unanswered
  answered_at TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  correct INTEGER,                              -- NULL until graded
  feedback TEXT,
  grade_error TEXT,                             -- the grader failed; the learner can grade again
  PRIMARY KEY (test_id, idx)
);

-- Search (GET /api/search): server/search.ts.

-- No constraints: a conflict clause inside a trigger gives way to the outer statement's, so an upsert would fail on a
-- queued duplicate. syncSearch reads the rows distinct.
CREATE TABLE IF NOT EXISTS search_queue (      -- the triggers below; A empties it when it indexes
  kind TEXT NOT NULL,                           -- SearchKind
  ref TEXT NOT NULL                             -- row id; for a term, topic_id || '/' || key
);

CREATE TABLE IF NOT EXISTS search_entries (    -- A: what a hit shows, only text the browser may see (L7)
  id INTEGER PRIMARY KEY,                       -- rowid of search_index
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  lesson_id TEXT,
  step_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (kind, ref)
);

-- A: title and body of search_entries, folded by foldForSearch (shared/search.ts); trigrams match inside words.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(title, body, tokenize = 'trigram');

CREATE TRIGGER IF NOT EXISTS search_topic_ins AFTER INSERT ON topics BEGIN INSERT INTO search_queue VALUES ('topic', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_topic_upd AFTER UPDATE OF title, request ON topics BEGIN INSERT INTO search_queue VALUES ('topic', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_topic_del AFTER DELETE ON topics BEGIN INSERT INTO search_queue VALUES ('topic', old.id); END;
CREATE TRIGGER IF NOT EXISTS search_lesson_ins AFTER INSERT ON lessons BEGIN INSERT INTO search_queue VALUES ('lesson', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_lesson_upd AFTER UPDATE OF title, objective ON lessons BEGIN INSERT INTO search_queue VALUES ('lesson', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_lesson_del AFTER DELETE ON lessons BEGIN INSERT INTO search_queue VALUES ('lesson', old.id); END;
CREATE TRIGGER IF NOT EXISTS search_step_ins AFTER INSERT ON steps BEGIN INSERT INTO search_queue VALUES ('step', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_step_upd AFTER UPDATE OF content, status ON steps BEGIN INSERT INTO search_queue VALUES ('step', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_step_del AFTER DELETE ON steps BEGIN INSERT INTO search_queue VALUES ('step', old.id); END;
CREATE TRIGGER IF NOT EXISTS search_term_ins AFTER INSERT ON glossary_terms BEGIN INSERT INTO search_queue VALUES ('term', new.topic_id || '/' || new.key); END;
CREATE TRIGGER IF NOT EXISTS search_term_upd AFTER UPDATE ON glossary_terms BEGIN
  INSERT INTO search_queue VALUES ('term', old.topic_id || '/' || old.key), ('term', new.topic_id || '/' || new.key);
END;
CREATE TRIGGER IF NOT EXISTS search_term_del AFTER DELETE ON glossary_terms BEGIN INSERT INTO search_queue VALUES ('term', old.topic_id || '/' || old.key); END;
CREATE TRIGGER IF NOT EXISTS search_note_ins AFTER INSERT ON notes BEGIN INSERT INTO search_queue VALUES ('note', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_note_upd AFTER UPDATE ON notes BEGIN INSERT INTO search_queue VALUES ('note', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_note_del AFTER DELETE ON notes BEGIN INSERT INTO search_queue VALUES ('note', old.id); END;
CREATE TRIGGER IF NOT EXISTS search_card_ins AFTER INSERT ON cards BEGIN INSERT INTO search_queue VALUES ('card', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_card_upd AFTER UPDATE OF content, status ON cards BEGIN INSERT INTO search_queue VALUES ('card', new.id); END;
CREATE TRIGGER IF NOT EXISTS search_card_del AFTER DELETE ON cards BEGIN INSERT INTO search_queue VALUES ('card', old.id); END;

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_item ON attempts(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(status, due);
CREATE INDEX IF NOT EXISTS idx_items_topic ON items(topic_id, status);
CREATE INDEX IF NOT EXISTS idx_hint_views_item ON hint_views(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worked_answers_step ON worked_answers(step_id);
CREATE INDEX IF NOT EXISTS idx_alternatives_step ON alternatives(step_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retries_item ON retries(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_practice_tests_topic ON practice_tests(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_practice_test_items_item ON practice_test_items(item_id);
