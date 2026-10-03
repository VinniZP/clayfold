---
name: goal-plan
description: Start a new goal. Interview the learner about what they want to build or achieve, write the goal, and plan the courses that lead to it.
argument-hint: "<the learner's goal>"
disable-model-invocation: true
---

Plan the courses that lead the learner to their goal. Their request: $ARGUMENTS

A goal holds no lessons. Each plan entry becomes a separate course when the learner opens it, and that course's own onboarding interviews the learner in depth, gathers sources and checks their level. Your job is the map above the courses: which ones, in what order, and why each one serves the goal. Stay at that altitude.

Planning spans several turns: every question to the learner goes through `ask_learner`, and the turn ends right after that call. Each later turn resumes here with their answer. Find the first phase whose completion criterion is not met yet (check the conversation and `MISSION.md` in the current directory) and continue from it.

## 1. Interview

Ask ONE question per turn with `ask_learner`: 3–5 concrete options that fit this goal plus `allowFree: true`, then end the turn. Skip any question the request or an earlier answer already settles. In order:

1. **Outcome**: what the result does and for whom, and what changes for the learner once it exists. "An app" is a means; the outcome is "my clients book sessions without messaging me".
2. **First version**: the smallest version that already delivers the outcome. Offer cuts of the learner's idea as options.
3. **Constraints**: hours per week, deadline, the devices and computer they work on.
4. **Experience**: what they have built, used or studied that is close to this goal, and how they build today: by hand, or by directing an AI assistant that writes the code.

Take the stack, tools and level of detail from the learner. When they name a stack, plan for it; when they name none, plan courses about concepts that carry over to any stack and leave the choice to the course that first needs it.

Done when the outcome, the first version, the constraints and the experience are known.

## 2. Goal

Write `MISSION.md` in the format of [goal-format.md](${CLAUDE_SKILL_DIR}/goal-format.md), in the learner's language.

## 3. Plan

Call `goal_plan_set` with 4–10 entries, in the order to take them:

- An entry is one course: a subject that a course onboarding turns into 6–25 lessons of 15–30 minutes. Split a bigger subject; merge smaller ones.
- `stage` names a stage of the first version the course serves ("A working prototype", "Data that survives a restart", "Friends can install it"). Stages follow the order of building; within a stage, a course comes after the courses it builds on.
- Cover the supporting skills the goal needs and the learner lacks: working with files and the terminal, version control, data storage, deployment or publishing, accounts and keys, costs. Leave out what the learner already does well, and say so in the wrap-up.
- The courses teach understanding: enough for the learner to build the first version, read and check code an AI assistant writes for them, and fix it when it breaks.
- `why` is one sentence in the learner's language: what this course lets them do for the goal.
- `brief` is the request the course onboarding receives, in the learner's language, under 1000 characters: the goal in one sentence, why this course, what the learner already knows that bears on it, how they build (by hand or through an AI assistant), the stack if they named one, their hours per week, and which subjects other courses of the plan cover.

When you are unsure what a stage requires today, check with WebSearch before planning it.

## 4. Wrap-up

Finish with a short message: the goal in one sentence, the stages with their courses and one line each on why, what you left out because the learner knows it, and a rough total in weeks at their hours per week. Tell them to open the first course from the plan, and that they can ask you here to change the plan. End the turn.

## Later turns

The learner may ask to add, drop, merge or reorder courses, or change the goal. A platform message may also list facts the goal's courses recorded about the learner; check the plan and `MISSION.md` against them and propose the changes they call for. Make the change with `goal_plan_set`, keeping every entry id that stays. An entry the learner already opened stays in the plan. When the goal itself changes, update `MISSION.md` first after confirming with the learner.
