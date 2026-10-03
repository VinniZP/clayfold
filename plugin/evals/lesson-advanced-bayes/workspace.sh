#!/bin/bash
set -e
cat > MISSION.md <<'MD'
# Mission: Bayesian A/B tests

## Why
Move the team's A/B tests to Bayesian analysis and explain to managers the probability that variant B is better than A.

## Success means
- I compute the posterior distribution of a conversion rate in a beta-binomial model in Python myself.
- I interpret a Bayesian credible interval and the expected loss for a rollout decision.
- I choose a prior distribution and justify the choice.

## Constraints
- 4 hours a week, a 2-month deadline.

## Already know
- 3 years of frequentist A/B testing: t-test, z-test for proportions, p-value. University-level probability theory. Python and pandas daily.

## Interests and context
- E-commerce: purchase funnels, order conversion, average order value.

## Out of scope
- MCMC and hierarchical models — later.
MD
printf '# Notes\n- Prefers an informal tone.\n- Prefers going straight to problems, theory only as needed.\n' > NOTES.md
cat > RESOURCES.md <<'MD'
# Sources: Bayesian A/B tests

## Knowledge

- [Conjugate prior: Beta-binomial](https://stats-handbook.example.edu/conjugate-beta-binomial) — `sourceId: src_beta_binomial`, reference · academic · stats-handbook.example.edu
  Conjugacy of the beta distribution and the binomial likelihood. For nodes: beta-prior, beta-binomial-ab.
- [Bayesian A/B testing for conversion rates](https://ab-notes.example.com/bayesian-ab-testing) — `sourceId: src_bayes_ab`, article · independent-practitioner · ab-notes.example.com
  Probability to be best, expected loss, stopping rule. For nodes: beta-binomial-ab, expected-loss.
MD
printf '# Glossary: Bayesian A/B tests\n\n**Posterior distribution**:\nThe distribution of a parameter after taking the data into account.\n' > GLOSSARY.md
mkdir -p learning-records
cat > learning-records/0001-conjugate-update.md <<'MD'
# Updates a Beta prior from conversion data without hints

The learner derived the posterior Beta(α + successes, β + failures) on their own and explained what the parameters mean. No need to repeat conjugacy theory; start lessons with problems.

**Evidence**: placement "first step" question on beta-prior answered correctly; 3 problems on the beta-binomial-ab node solved without hints, 2026-10-02.
MD
