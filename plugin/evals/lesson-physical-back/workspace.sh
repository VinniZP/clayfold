#!/bin/bash
set -e
cat > MISSION.md <<'MD'
# Mission: Back stretching

## Why
Relieve lower-back stiffness after a day at the computer and do a short stretch every evening.

## Success means
- I do a 10-minute routine of 4–5 exercises without a cheat sheet.
- I know which sensations mean I should stop an exercise.

## Constraints
- 10–15 minutes a day, at home, I have a mat.
- No back injuries; a doctor found nothing wrong.

## Already know
- Nothing systematic; I stretch now and then "however it goes".

## Interests and context
- Works as a programmer, sits a lot; cycles on weekends.

## Out of scope
- Strength training.
MD
printf '# Notes\n- Prefers an informal tone.\n' > NOTES.md
cat > RESOURCES.md <<'MD'
# Sources: Back stretching

## Knowledge

- [Exercises for lower back pain](https://health-service.example.org/back-exercises) — `sourceId: src_back_exercises`, reference · vendor-official · health-service.example.org
  Step-by-step lower-back stretching exercises. For nodes: knee-to-chest, pelvic-tilt.
- [Back pain: when to get help](https://physio-society.example.net/back-pain-help) — `sourceId: src_back_safety`, reference · community · physio-society.example.net
  Signs that mean you should stop and see a doctor. For nodes: safety-signals.
MD
printf '# Glossary: Back stretching\n' > GLOSSARY.md
