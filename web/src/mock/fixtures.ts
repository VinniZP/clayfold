import type { ActivityDay, AlternativeView, AuditEntry, CalibrationView, CardView, ChatMessage, ExplainLens, GlossaryEntry, ItemState, LessonSummary, MaterialView, MemoryFile, MistakeEntry, MistakePattern, NodeView, NoteView, SourceView, SystemView, TodayView, TopicDetail, UpdateView, VideoTimeline, WeakSpot } from "@shared/api";
import type { PublicCite, PublicFigure, PublicItem, PublicStep } from "@shared/schemas";

// Development fixtures for VITE_MOCK=1. Content is illustrative.

export const iso = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};

// ---------- Keys the mock server grades against ----------

export type Key = {
  correct: number | number[] | string[] | number | string[][] | null;
  kind: PublicItem["format"];
  tolerance?: number;
  optionFeedback?: string[];
  /** match and sort: feedback per entry, by display index, shown when it is placed wrong. */
  placementFeedback?: Record<number, string>;
  feedback?: string;
  solution: string;
  correctAnswer: string;
  hints: string[];
  /** short: what a correct answer mentions; the server grades by model instead. */
  accept?: RegExp;
};

export const keys: Record<string, Key> = {};

function item(id: string, pub: Omit<PublicItem, "id" | "hintCount">, key: Omit<Key, "kind">): PublicItem {
  keys[id] = { ...key, kind: pub.format };
  return { id, ...pub, hintCount: key.hints.length };
}

const cites: PublicCite[] = [
  {
    sourceId: "s1",
    title: "Think Bayes, Chapter 1",
    url: "https://allendowney.github.io/ThinkBayes2/chap01.html",
    quote: "The probability of A given B is the probability of A and B divided by the probability of B.",
  },
  {
    sourceId: "s2",
    title: "Gigerenzer & Hoffrage, 1995",
    url: "https://doi.org/10.1037/0033-295X.102.4.684",
    quote: "Bayesian algorithms are computationally simpler when information is presented in natural frequencies.",
  },
  {
    sourceId: "s1",
    title: "Think Bayes, Chapter 1",
    url: "https://allendowney.github.io/ThinkBayes2/chap01.html",
    quote: "Bayes's theorem is a way to compute a conditional probability when the inverse is known.",
  },
];

// ---------- Figures ----------

const mermaidFig: PublicFigure = {
  kind: "mermaid",
  teaches: "How 1000 people split by disease and test result",
  alt: "Diagram: of the people with the disease, 90% test positive and 10% test negative; of the healthy, 9% get a false positive and 91% test negative.",
  caption: "Both groups get positive results, so a single result is not enough.",
  code: `flowchart LR
  A["Has the disease · 1%"] -->|"test + · 90%"| B["True positive"]
  A -->|"test − · 10%"| C["False negative"]
  D["No disease · 99%"] -->|"test + · 9%"| E["False positive"]
  D -->|"test − · 91%"| F["True negative"]`,
};

const brokenMermaid: PublicFigure = {
  kind: "mermaid",
  teaches: "How joint and conditional probability relate",
  alt: "Diagram linking P(A and B), P(B) and P(A|B).",
  code: `flowchart LR
  A["P(A and B)"] --> B[P(A|B)
  B --> C{{unclosed block`,
};

const svgFig: PublicFigure = {
  kind: "svg",
  teaches: "Natural frequency tree for a rare disease test",
  alt: "Tree: 1000 people split into 10 sick and 990 healthy. Of the 10 sick, 9 test positive. Of the 990 healthy, 89 test positive.",
  caption: "Compare the two numbers at the bottom: 9 real detections against 89 false alarms.",
  svg: `<svg viewBox="0 0 560 250" xmlns="http://www.w3.org/2000/svg" font-family="inherit" font-size="14">
  <g fill="none" stroke-width="2">
    <path d="M280 46 L140 110" stroke="var(--fig-5)"/>
    <path d="M280 46 L420 110" stroke="var(--fig-1)"/>
    <path d="M140 138 L70 200" stroke="var(--fig-5)"/>
    <path d="M140 138 L210 200" stroke="var(--fig-5)" stroke-dasharray="4 4"/>
    <path d="M420 138 L350 200" stroke="var(--fig-1)"/>
    <path d="M420 138 L490 200" stroke="var(--fig-1)" stroke-dasharray="4 4"/>
  </g>
  <g fill="currentColor" text-anchor="middle">
    <rect x="220" y="14" width="120" height="32" rx="10" fill="var(--fig-6)" opacity=".14"/>
    <text x="280" y="35" font-weight="600">1000 people</text>
    <text x="140" y="130" font-weight="600">10 sick</text>
    <text x="420" y="130" font-weight="600">990 healthy</text>
    <text x="70" y="222" font-weight="700" fill="var(--fig-5)">9 test +</text>
    <text x="210" y="222">1 test −</text>
    <text x="350" y="222" font-weight="700" fill="var(--fig-1)">89 test +</text>
    <text x="490" y="222">901 test −</text>
  </g>
</svg>`,
};

const chartFig: PublicFigure = {
  kind: "chart",
  teaches: "Share of true positives among all positive results",
  alt: "Horizontal bars: 9 true positive and 89 false positive results out of 98 positives.",
  caption: "Of 98 positive results, the disease is confirmed in 9.",
  spec: {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: 420,
    height: 90,
    data: {
      values: [
        { group: "True positives", n: 9 },
        { group: "False positives", n: 89 },
      ],
    },
    layer: [
      { mark: { type: "bar", cornerRadiusEnd: 6 }, encoding: { color: { field: "group", type: "nominal", legend: null } } },
      { mark: { type: "text", align: "left", dx: 6, fontWeight: 600 }, encoding: { text: { field: "n" } } },
    ],
    encoding: {
      y: { field: "group", type: "nominal", title: null, sort: null },
      x: { field: "n", type: "quantitative", title: "people out of 1000" },
    },
  },
};

const widgetFig: PublicFigure = {
  kind: "widget",
  purpose: "parameter",
  teaches: "How disease prevalence changes the probability of disease after a positive test",
  alt: "A slider for disease prevalence from 0.1% to 50% and a bar showing the probability of disease after a positive test, with 90% sensitivity and a 9% false positive rate.",
  caption: "Sensitivity 90%, false positive rate 9%. Move only the prevalence.",
  html: `<style>
  .w{display:grid;gap:12px;padding:4px 2px}
  label{display:flex;justify-content:space-between;font-weight:600}
  input{width:100%;accent-color:var(--fig-1)}
  .bar{height:28px;border-radius:8px;background:var(--surface-2);overflow:hidden}
  .fill{height:100%;background:var(--fig-1);transition:width .2s}
  .out{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
  .muted{color:var(--text-muted)}
</style>
<div class="w">
  <label for="p">Prevalence <span id="pv">1%</span></label>
  <input id="p" type="range" min="0.1" max="50" step="0.1" value="1">
  <div class="muted">Probability of disease after a positive test</div>
  <div class="out" id="o">9%</div>
  <div class="bar"><div class="fill" id="f"></div></div>
</div>
<script>
  var p=document.getElementById('p'),pv=document.getElementById('pv'),o=document.getElementById('o'),f=document.getElementById('f');
  function u(){var pr=p.value/100,post=.9*pr/(.9*pr+.09*(1-pr));pv.textContent=(+p.value).toLocaleString('en')+'%';o.textContent=Math.round(post*100)+'%';f.style.width=(post*100)+'%'}
  p.addEventListener('input',u);u();
</script>`,
};

// ---------- Lesson 1: generated live ----------

export const bayesOutline = [
  { kind: "activate", title: "Warm-up: what do you expect?" },
  { kind: "explain", title: "Forward and inverse probability" },
  { kind: "explain", title: "Frequencies instead of percentages" },
  { kind: "worked_example", title: "Walkthrough: a test for a rare disease" },
  { kind: "practice", title: "Order of the calculation" },
  { kind: "explain", title: "The role of prevalence" },
  { kind: "practice", title: "Work it out yourself" },
  { kind: "practice", title: "Extra problem" },
  { kind: "reflect", title: "Why intuition gets it wrong" },
  { kind: "check", title: "Check" },
];

export const bayesSteps: (PublicStep | null)[] = [
  {
    id: "st-0",
    idx: 0,
    kind: "activate",
    title: "Warm-up: what do you expect?",
    items: [
      item(
        "a1",
        {
          format: "single",
          prompt: "A test detects the disease in 90% of sick people and wrongly fires in 9% of healthy people. 1% of people have the disease. A person got a **positive** result. What is the probability that they are sick?",
          bloom: "apply",
          options: [{ text: "About 90%" }, { text: "About 50%" }, { text: "About 9%" }],
        },
        {
          correct: 2,
          optionFeedback: ["That is the test's sensitivity, the share of positives among the sick, but the question asks the reverse.", "Close to intuition, but the rarity of the disease pulls the answer down.", "Yes: false alarms among the healthy far outnumber detections among the sick."],
          solution: "Of 1000 people, 10 are sick and the test detects 9. Of the 990 healthy, the test wrongly fires for 89. That makes 98 positives, 9 of them sick: **9 / 98 ≈ 9%**.",
          correctAnswer: "About 9%",
          hints: [],
        },
      ),
      item(
        "a2",
        { format: "number", prompt: "How many people out of 1000 are sick if the disease affects 1%?", bloom: "remember", unit: "people" },
        { correct: 10, tolerance: 0, solution: "1% of 1000 is **10 people**.", correctAnswer: "10 people", hints: [] },
      ),
    ],
  },
  {
    id: "st-1",
    idx: 1,
    kind: "explain",
    title: "Forward and inverse probability",
    body: `A test is described by a **forward** probability: if a person is sick, the test is positive with probability 90%. That is P(test+ | sick).

A person holding a result needs the **inverse** probability: P(sick | test+). It is a different number, and it depends on how rare the disease is.

Bayes' theorem connects them:

> P(sick | test+) = P(test+ | sick) · P(sick) / P(test+)

The denominator P(test+) is the sum of two streams: positive results among the sick and among the healthy.`,
    figure: mermaidFig,
    cites,
    checks: [
      item(
        "c1",
        {
          format: "single",
          prompt: "The test's sensitivity is 90%. What exactly equals 90%?",
          bloom: "understand",
          options: [{ text: "P(test+ | sick)" }, { text: "P(sick | test+)" }, { text: "P(sick)" }],
        },
        {
          correct: 0,
          optionFeedback: ["Correct: sensitivity is the share of positive results among the sick.", "That is the inverse probability: it is what we are looking for, and it does not equal the sensitivity.", "That is the prevalence of the disease; it does not depend on the test."],
          solution: "Sensitivity is **P(test+ | sick)**: the test detects 90% of the sick.",
          correctAnswer: "P(test+ | sick)",
          hints: ["Sensitivity describes the test, not the patient holding a result.", "Within which group is the share computed: among the sick or among the positives?"],
        },
      ),
    ],
  },
  {
    id: "st-2",
    idx: 2,
    kind: "explain",
    title: "Frequencies instead of percentages",
    body: `Percentages are easier to grasp when you turn them into people. Take **1000 people** and walk down the tree: first split by disease, then by test result.

Two groups get a positive result. The answer to the question is the share of the first group among all positives.`,
    figure: svgFig,
    cites,
    checks: [
      item(
        "c2",
        { format: "cloze", prompt: "Fill in the blanks using the tree.", bloom: "apply", text: "Of 1000 people, {{1}} are sick, and the test detects {{2}} of them.", blankCount: 2 },
        {
          correct: [["10"], ["9"]],
          solution: "1% of 1000 = 10 sick; 90% of 10 = 9 detections.",
          correctAnswer: "10 and 9",
          hints: ["The first number is 1% of 1000.", "The second is 90% of the first."],
        },
      ),
      item(
        "c2m",
        {
          format: "match",
          prompt: "Match each probability from the test example to what it describes.",
          bloom: "understand",
          entries: ["P(test+ | sick)", "P(sick)", "P(test+ | healthy)", "P(sick | test+)"],
          targets: ["The share of positives who are actually sick", "The false positive rate", "The test's sensitivity", "The prevalence of the disease", "The share of healthy people who test negative"],
        },
        {
          correct: [2, 3, 1, 0],
          placementFeedback: {
            0: "**P(test+ | sick)**: the part after the bar names the group; this share is computed among the sick, not among the positives.",
            2: "**P(test+ | healthy)**: a positive result in a healthy person is a false alarm, not a correct negative.",
            3: "**P(sick | test+)**: the group here is everyone who tested positive; the question is how many of them are sick.",
          },
          solution: "P(test+ | sick) is the sensitivity, P(sick) the prevalence, P(test+ | healthy) the false positive rate, and P(sick | test+) the share of positives who are actually sick. The share of healthy people who test negative, P(test− | healthy), pairs with none of them.",
          correctAnswer: "P(test+ | sick) → sensitivity; P(sick) → prevalence; P(test+ | healthy) → false positive rate; P(sick | test+) → share of positives who are sick",
          hints: ["Read the part after the bar first: it names the group the share is computed in.", "Only one of the four is computed among the people who tested positive."],
        },
      ),
    ],
  },
  {
    id: "st-3",
    idx: 3,
    kind: "worked_example",
    title: "Walkthrough: a test for a rare disease",
    problem: "The disease affects 1% of people. The test's sensitivity is 90%, its false positive rate 9%. Find P(sick | test+).",
    lines: [
      { idx: 0, text: "Take 1000 people: **10 sick** and **990 healthy**." },
      { idx: 1, text: "Among the sick, 90% test positive: **9 people**." },
      { idx: 2, blankPrompt: "How many healthy people will test positive (9% of 990)?" },
      { idx: 3, text: "Total positives: 9 + 89 = **98**." },
      { idx: 4, blankPrompt: "What share of the 98 positives is actually sick?" },
      { idx: 5, blankPrompt: "In one sentence: why is the answer so far below the test's 90% sensitivity?", blankOpen: true },
    ],
    figure: chartFig,
    cites,
  },
  {
    id: "st-4",
    idx: 4,
    kind: "practice",
    title: "Order of the calculation",
    item: item(
      "p1",
      {
        format: "order",
        prompt: "Put the steps for calculating P(sick | test+) in order.",
        bloom: "apply",
        entries: ["Add up all positive results", "Take the prevalence of the disease", "Divide true positives by all positives", "Find the positives among the sick", "Find the positives among the healthy"],
      },
      {
        correct: ["Take the prevalence of the disease", "Find the positives among the sick", "Find the positives among the healthy", "Add up all positive results", "Divide true positives by all positives"],
        feedback: "Start with how many people are sick: without that you cannot compute any group.",
        solution: "Prevalence → positives among the sick → among the healthy → total → share of true positives.",
        correctAnswer: "prevalence → sick+ → healthy+ → total → share",
        hints: ["What do you need to know first to split 1000 people into groups?", "Division is the last step: first you need the denominator."],
      },
    ),
  },
  {
    id: "st-5",
    idx: 5,
    kind: "explain",
    title: "The role of prevalence",
    body: "The same test gives a different answer in a different group of people. If the disease is common, a positive result means much more. Move the slider and watch how the probability changes.",
    figure: widgetFig,
    cites,
    checks: [
      item(
        "c3",
        {
          format: "multi",
          prompt: "What will **increase** P(sick | test+)?",
          bloom: "analyze",
          options: [{ text: "Higher prevalence of the disease" }, { text: "Fewer false positive results" }, { text: "More people tested" }, { text: "A second independent positive test" }],
        },
        {
          correct: [0, 1, 3],
          feedback: "The number of people tested scales every group proportionally and does not shift the share.",
          solution: "The share of sick people among the positives grows with higher prevalence, fewer false positives, and a repeated independent test.",
          correctAnswer: "1, 2 and 4",
          hints: ["Think about which changes shift the ratio of 9 to 89.", "If you test 10 times as many people, both groups grow tenfold."],
        },
      ),
    ],
  },
  {
    id: "st-6",
    idx: 6,
    kind: "practice",
    title: "Work it out yourself",
    item: item(
      "p2",
      {
        format: "number",
        prompt: "The disease affects 2% of people, sensitivity is 95%, the false positive rate 5%. Find P(sick | test+) as a percentage, rounded to a whole number.",
        bloom: "apply",
        unit: "%",
      },
      {
        correct: 28,
        tolerance: 1,
        feedback: "Check the denominator: it must include positives among both the sick and the healthy.",
        solution: "Out of 1000: 20 sick, 19 positive; 980 healthy, 49 positive. 19 / 68 ≈ **28%**.",
        correctAnswer: "28%",
        hints: ["Convert to people: how many of the 1000 are sick?", "Positives among the healthy: 5% of 980.", "Divide 19 by the sum 19 + 49."],
      },
    ),
  },
  null,
  {
    id: "st-8",
    idx: 8,
    kind: "reflect",
    title: "Why intuition gets it wrong",
    prompt: "Explain in your own words why, even with an accurate test, a positive result can mean almost nothing.",
    purpose: "why",
  },
  {
    id: "st-9",
    idx: 9,
    kind: "check",
    title: "Check",
    items: [
      item(
        "k1",
        {
          format: "single",
          prompt: "The disease affects 0.1% of people. Test: sensitivity 99%, false positive rate 1%. Closest to P(sick | test+):",
          bloom: "apply",
          options: [{ text: "9%" }, { text: "50%" }, { text: "99%" }],
        },
        { correct: 0, optionFeedback: ["Correct.", "False alarms outnumber detections almost tenfold.", "That is the sensitivity, not the inverse probability."], solution: "Out of 100,000: 100 sick, 99 detections; 999 false alarms. 99/1098 ≈ 9%.", correctAnswer: "9%", hints: [] },
      ),
      item(
        "k2",
        { format: "short", prompt: "How does P(A | B) differ from P(B | A)? Answer in one or two sentences.", bloom: "understand" },
        { correct: null, solution: "They are shares within different groups: among B and among A.", correctAnswer: "", hints: [] },
      ),
      item(
        "k3",
        { format: "cloze", prompt: "Complete the formula.", bloom: "remember", text: "P(sick | test+) = P(test+ | sick) · {{1}} / P(test+)", blankCount: 1 },
        { correct: [["P(sick)", "p(sick)", "prevalence"]], solution: "The missing piece is the prior probability P(sick).", correctAnswer: "P(sick)", hints: [] },
      ),
    ],
  },
];

export const workedLines: Record<string, Record<number, { answers: string[]; text: string }>> = {
  "st-3": {
    2: { answers: ["89", "89,1", "89.1"], text: "9% of 990 ≈ **89 people** get a false positive result." },
    4: { answers: ["9/98", "9%", "0,09", "0.09", "9.2%", "9,2%"], text: "9 / 98 ≈ **9%**: nine of every 98 positives are actually sick." },
    5: { answers: [], text: "Healthy people outnumber the sick 99 to 1, so their 89 false alarms outweigh the 9 true detections." },
  },
};

// ---------- Lesson 2: finished, shows a broken figure ----------

export const condSteps: PublicStep[] = [
  {
    id: "cs-0",
    idx: 0,
    kind: "activate",
    title: "Warm-up",
    items: [
      item(
        "ca1",
        {
          format: "single",
          prompt: "A class has 30 students; 12 play chess, and 6 of those are girls. What share of the chess players are girls?",
          bloom: "apply",
          options: [{ text: "6/30" }, { text: "6/12" }, { text: "12/30" }],
        },
        { correct: 1, optionFeedback: ["That is the share of the whole class.", "Yes: we count within the group of chess players.", "That is the share of chess players in the class."], solution: "The condition \"among chess players\" narrows the group to 12: 6/12 = 0.5.", correctAnswer: "6/12", hints: [] },
      ),
      item(
        "ca2",
        { format: "multi", prompt: "Which notations mean conditional probability?", bloom: "remember", options: [{ text: "P(A | B)" }, { text: "P(A and B)" }, { text: "P(A given B)" }] },
        { correct: [0, 2], solution: "P(A | B) and \"given\" mean the same thing; P(A and B) is the joint probability.", correctAnswer: "1 and 3", hints: [] },
      ),
    ],
  },
  {
    id: "cs-1",
    idx: 1,
    kind: "explain",
    title: "Joint and conditional probability",
    body: "[[Conditional probability]] is the [[joint probability|Joint probability]] divided by the probability of the condition: P(A | B) = P(A and B) / P(B).",
    figure: brokenMermaid,
    cites,
    checks: [
      item(
        "cc2",
        {
          format: "sort",
          prompt: "Each statement describes a probability. Is it joint or conditional?",
          bloom: "understand",
          entries: [
            "Of the people with a positive test, the share who are sick",
            "The chance that a random person is sick and tests positive",
            "The share of chess players among the girls",
            "The chance that a day is both cloudy and rainy",
            "The chance of rain on a day when clouds are forecast",
            "The share of students who are girls and play chess",
          ],
          categories: ["Joint: P(A and B)", "Conditional: P(A | B)"],
        },
        {
          correct: [1, 0, 1, 0, 1, 0],
          placementFeedback: {
            1: "**The chance that a random person is sick and tests positive**: the share is taken over everyone; nothing narrows the group.",
            2: "**The share of chess players among the girls**: “among the girls” narrows the group before the share is taken.",
            4: "**The chance of rain on a day when clouds are forecast**: only days with a cloud forecast count.",
          },
          solution: "Conditional statements narrow the group first (“of the people with a positive test”, “among the girls”, “on a day when clouds are forecast”). Joint statements take both events over everyone (“sick and tests positive”, “cloudy and rainy”, “girls and play chess”).",
          correctAnswer: "Joint: sick and positive, cloudy and rainy, girls who play chess; Conditional: sick among positives, chess players among girls, rain given a forecast",
          hints: ["Look for words that narrow the group: “of”, “among”, “when”.", "A joint probability counts both events over everyone."],
        },
      ),
      item(
        "cc1",
        { format: "short", prompt: "In your own words: what does dividing by P(B) do?", bloom: "understand" },
        { correct: null, solution: "It keeps only the cases where B happened.", correctAnswer: "", hints: ["Think about which group we keep."] },
      ),
    ],
  },
  // The same prompt as the generator wrote it before the format rule, and in the structured form.
  {
    id: "cs-2",
    idx: 2,
    kind: "practice",
    title: "Choosing a pattern (dense text)",
    item: item(
      "pub-dense",
      {
        format: "short",
        bloom: "evaluate",
        prompt:
          "The client is a publishing house. It needs two features. (A) Given a topic from an editor, put together a review: find sources, pick out the key points and combine them into one text; (B) Translate fiction so that the author's style is preserved. Which workflow pattern would you choose for each feature, and how would you justify the choice to the client?",
      },
      { correct: null, solution: "(A): orchestrator–workers, because the number of sources is not known in advance. (B): evaluator–optimizer, because the style is checked and improved in a loop.", correctAnswer: "", hints: ["For which feature are the steps known in advance?", "Where do you need to check the result and repeat?"] },
    ),
  },
  {
    id: "cs-3",
    idx: 3,
    kind: "practice",
    title: "Choosing a pattern (structured)",
    item: item(
      "pub-structured",
      {
        format: "short",
        bloom: "evaluate",
        prompt:
          "The client is a publishing house. It needs two features.\n\n- **(A)** Given a topic from an editor, put together a review: find sources, pick out the key points and combine them into one text.\n- **(B)** Translate fiction so that the author's style is preserved.\n\nWhich workflow pattern would you choose for each feature, and how would you justify the choice to the client?",
      },
      { correct: null, solution: "(A): orchestrator–workers, because the number of sources is not known in advance. (B): evaluator–optimizer, because the style is checked and improved in a loop.", correctAnswer: "", hints: ["For which feature are the steps known in advance?", "Where do you need to check the result and repeat?"] },
    ),
  },
];

// ---------- Practice sets: items the simulated practice-set run publishes, in turn ----------

export const practiceSetPool: { nodeId: string; title: string; item: PublicItem }[] = [
  {
    nodeId: "bayes-theorem",
    title: "A flagged bike brake",
    item: item(
      "pp1",
      {
        format: "single",
        prompt: "In a city, 1 in 100 bikes has a faulty brake. A quick roadside test flags 90% of faulty brakes and 10% of good ones.\n\nYour bike is **flagged**. Which is closest to the chance that its brake is faulty?",
        bloom: "apply",
        options: [{ text: "About 8%" }, { text: "About 90%" }, { text: "About 50%" }],
      },
      {
        correct: 0,
        optionFeedback: ["Yes: false flags on the many good bikes outnumber the true ones.", "That is the share of faulty brakes the test flags, the reverse of the question.", "The rarity of faulty brakes pulls the answer far below a coin toss."],
        solution: "Of 1000 bikes, 10 are faulty and 9 of them are flagged. Of the 990 good ones, 99 are flagged. **9 / 108 ≈ 8%**.",
        correctAnswer: "About 8%",
        hints: ["Turn the percentages into a group of 1000 bikes.", "Count the flagged bikes in both groups, then take the faulty share."],
      },
    ),
  },
  {
    nodeId: "bayes-theorem",
    title: "Positives on a hiking trip",
    item: item(
      "pp2",
      { format: "number", prompt: "Of 1,000 hikers, 20 have a rare pollen allergy. A skin test is positive for 18 of them and for 49 of the others.\n\nHow many hikers test positive in total?", bloom: "apply", unit: "hikers" },
      { correct: 67, tolerance: 0, feedback: "Add the positives from both groups.", solution: "18 true positives plus 49 false positives: **67 hikers**.", correctAnswer: "67 hikers", hints: ["Positives come from two groups.", "Add the allergic and the non-allergic positives."] },
    ),
  },
  {
    nodeId: "priors",
    title: "Before and after the result",
    item: item(
      "pp3",
      { format: "cloze", prompt: "Which words are missing?", bloom: "understand", text: "The share of a group before any test is the {{1}}; once the result is in, it becomes the {{2}} probability.", blankCount: 2 },
      { correct: [["prior", "base rate"], ["posterior"]], solution: "Before the test: the **prior** (base rate). After the test: the **posterior** probability.", correctAnswer: "prior; posterior", hints: ["One word means “before”.", "The other means “after”."] },
    ),
  },
  {
    nodeId: "base-rate",
    title: "A headline about a 99% test",
    item: item(
      "pp4",
      {
        format: "multi",
        prompt: "A headline says: “The test is 99% accurate, so a positive result means you are almost surely ill.”\n\nSelect all that apply: what do you need to judge the claim?",
        bloom: "analyze",
        options: [{ text: "How common the illness is" }, { text: "How often healthy people test positive" }, { text: "How many labs run the test" }],
      },
      { correct: [0, 1], solution: "The answer depends on the **base rate** and the **false-positive rate**; the number of labs changes nothing.", correctAnswer: "The base rate and the false-positive rate", hints: ["Think about the two groups that can test positive.", "What decides how large each group is?"] },
    ),
  },
  {
    nodeId: "bayes-theorem",
    title: "Steps of a frequency tree",
    item: item(
      "pp5",
      {
        format: "order",
        prompt: "In what order do you find P(ill | positive) with natural frequencies?",
        bloom: "apply",
        entries: ["Divide the true positives by all positives", "Pick a group of 1,000 people", "Apply the hit rate and the false-alarm rate", "Split the group by the base rate"],
      },
      {
        correct: ["Pick a group of 1,000 people", "Split the group by the base rate", "Apply the hit rate and the false-alarm rate", "Divide the true positives by all positives"],
        solution: "Group → split by base rate → apply both test rates → true positives over all positives.",
        correctAnswer: "Group, base rate, test rates, divide",
        hints: ["You need people before you can split them.", "The division comes last."],
      },
    ),
  },
  {
    nodeId: "base-rate",
    title: "Two clinics, one test",
    item: item(
      "pp6",
      {
        format: "single",
        prompt: "Two clinics use the same test. Clinic A sees mostly patients with symptoms; clinic B screens the general public.\n\nWhere does a positive result say more about illness?",
        bloom: "analyze",
        options: [{ text: "Clinic A, because more of its patients are ill" }, { text: "Clinic B, because it tests far more people" }, { text: "Both alike, because the test is the same" }],
      },
      {
        correct: 0,
        optionFeedback: ["Yes: a higher base rate means more of the positives are true.", "More people tested does not change the share of true positives.", "The same test gives different answers when the base rates differ."],
        solution: "In clinic A the base rate is higher, so true positives make up a larger share of all positives.",
        correctAnswer: "Clinic A",
        hints: ["What differs between the two groups of patients?", "How does the base rate change the share of true positives?"],
      },
    ),
  },
  {
    nodeId: "priors",
    title: "Updating the odds",
    item: item(
      "pp7",
      { format: "number", prompt: "The prior odds of a fault are 1 : 4. A warning light is 6 times as likely with a fault as without one.\n\nWhat are the posterior odds of a fault, as a single number?", bloom: "apply" },
      { correct: 1.5, tolerance: 0.01, feedback: "Multiply the prior odds by the likelihood ratio.", solution: "Posterior odds = prior odds × likelihood ratio = 0.25 × 6 = **1.5**.", correctAnswer: "1.5", hints: ["Write the prior odds as one number.", "Multiply by how much more likely the light is with a fault."] },
    ),
  },
  {
    nodeId: "bayes-theorem",
    title: "A positive doping test",
    item: item(
      "pp8",
      { format: "short", prompt: "A friend says a 95%-accurate doping test proves that an athlete who tested positive doped.\n\nAnswer in 1–2 sentences: what would you ask first, and why?", bloom: "evaluate" },
      { correct: null, solution: "Ask how common doping is **among** the athletes tested: with a low base rate, many positives are false alarms.", correctAnswer: "", hints: ["Which number does the friend leave out?", "Think about the false alarms among clean athletes."] },
    ),
  },
];

// ---------- Topics ----------

const node = (id: string, title: string, prereqs: string[], mastery: NodeView["mastery"], kind: NodeView["kind"] = "knowledge", placement: NodeView["placement"] = null): NodeView => ({
  id,
  title,
  prereqs,
  mastery,
  kind,
  placement,
  summary: `${title}: a key concept of the topic that the following nodes build on.`,
});

const bayesNodes: NodeView[] = [
  node("prob-basics", "Probability and events", [], "mastered", "knowledge", "known"),
  node("cond-prob", "Conditional probability", ["prob-basics"], "exit_passed", "knowledge", "partial"),
  node("likelihood", "Likelihood", ["cond-prob"], "learning"),
  node("bayes-theorem", "Bayes' theorem", ["cond-prob"], "learning", "knowledge", "unknown"),
  node("base-rate", "Base rate fallacy", ["bayes-theorem"], "new"),
  node("priors", "Prior distributions", ["bayes-theorem"], "new"),
  node("posterior", "Posterior distribution", ["priors", "likelihood"], "new"),
  node("ab-tests", "Bayesian A/B tests", ["posterior", "base-rate"], "new", "skill"),
];

const gitNodes: NodeView[] = [
  node("commits", "Commits and history", [], "mastered", "skill"),
  node("staging", "Index and staging", [], "mastered", "skill"),
  node("branches", "Branches", ["commits"], "exit_passed", "skill"),
  node("merge", "Merging and conflicts", ["branches", "staging"], "learning", "skill"),
  node("rebase", "Rebase", ["merge"], "new", "skill"),
];

const bayesLessons: LessonSummary[] = [
  { id: "l-cond", topicId: "t-bayes", title: "Conditional probability", objective: "Tell P(A | B) apart from P(A and B) and compute conditional probability from a table.", level: "novice", nodeIds: ["cond-prob"], status: "finished", createdAt: iso(9), stepsReady: 4, stepsTotal: 4, sourcesStale: true, supersededBy: null, learnerStatus: "in_progress", video: "ready", practice: null },
  { id: "l-bayes", topicId: "t-bayes", title: "Bayes' theorem through a medical test", objective: "Compute the probability of disease after a positive test using natural frequencies.", level: "novice", nodeIds: ["bayes-theorem"], status: "generating", createdAt: iso(0, 9), stepsReady: 3, stepsTotal: 10, sourcesStale: false, supersededBy: null, learnerStatus: "in_progress", video: null, practice: null },
  { id: "l-bayes-v1", topicId: "t-bayes", title: "Bayes' theorem through a medical test", objective: "Compute the probability of disease after a positive test using natural frequencies.", level: "novice", nodeIds: ["bayes-theorem"], status: "finished", createdAt: iso(5), stepsReady: 8, stepsTotal: 8, sourcesStale: false, supersededBy: "l-bayes", learnerStatus: "completed", video: null, practice: null },
];

const bayesSources: SourceView[] = [
  { id: "s1", url: "https://allendowney.github.io/ThinkBayes2/", title: "Think Bayes, 2nd edition", kind: "book", note: "chapters 1–4", status: "ok" },
  { id: "s2", url: "https://doi.org/10.1037/0033-295X.102.4.684", title: "Gigerenzer & Hoffrage, How to improve Bayesian reasoning", kind: "article", note: "natural frequencies", status: "ok" },
  { id: "s3", url: "https://example.org/stats-course", title: "Statistics course (page unavailable)", kind: "course", note: "", status: "failed" },
];

const bayesMaterials: MaterialView[] = [
  { id: "m1", title: "Lecture 4: Conditional probability and Bayes", kind: "pdf", url: null, bytes: 2_412_000, chars: 41_260, addedAt: iso(20), cited: true },
  { id: "m2", title: "Course syllabus, spring term", kind: "text", url: null, bytes: 3_180, chars: 3_102, addedAt: iso(20), cited: false },
  { id: "m3", title: "Seeing Theory: Bayesian inference", kind: "link", url: "https://seeing-theory.brown.edu/bayesian-inference/", bytes: null, chars: 9_870, addedAt: iso(3), cited: false },
];

const convs = (prefix: string, days: number[]) =>
  days.map((d, i) => ({
    id: `${prefix}-${i}`,
    kind: (i === 0 ? "onboard" : i % 3 === 0 ? "tutor" : i % 2 === 0 ? "review" : "lesson") as TopicDetail["conversations"][number]["kind"],
    lessonId: null,
    createdAt: iso(d, 9 + (i % 8)),
  }));

export const topicDetails: Record<string, TopicDetail> = {
  "t-bayes": {
    topic: { id: "t-bayes", slug: "bayes", title: "Bayesian statistics", createdAt: iso(20), dueCards: 3, nodesMastered: 1, nodesTotal: bayesNodes.length, running: false, kind: "topic", goalId: null, plan: null, final: null },
    nodes: bayesNodes,
    plan: [],
    goal: null,
    goalNotes: [],
    lessons: bayesLessons,
    sources: bayesSources,
    materials: bayesMaterials,
    conversations: [{ id: "c-onb-bayes", kind: "onboard", lessonId: null, createdAt: iso(20) }, ...convs("cb", [1, 2, 2, 4, 6, 8, 9, 11, 13, 15, 16, 22, 27, 30]).slice(1)],
    onboarding: [
      { key: "interview", label: "Interview", status: "done", detail: "goal: A/B tests at work" },
      { key: "mission", label: "Mission", status: "done", detail: "MISSION.md written" },
      { key: "sources", label: "Sources", status: "done", detail: "3 sources" },
      { key: "graph", label: "Knowledge map", status: "done", detail: "8 topics" },
      { key: "placement", label: "Level", status: "done", detail: "3 marked" },
    ],
  },
  "t-git": {
    topic: { id: "t-git", slug: "git", title: "Git basics", createdAt: iso(40), dueCards: 2, nodesMastered: 2, nodesTotal: gitNodes.length, running: false, kind: "topic", goalId: "t-goal", plan: null, final: null },
    nodes: gitNodes,
    plan: [],
    goal: { id: "t-goal", title: "Workout tracking app", why: "Keep every version of the app and roll back a change that broke it." },
    goalNotes: [],
    lessons: [{ id: "l-git", topicId: "t-git", title: "Branching and merging", objective: "Create branches, merge them and resolve a simple conflict.", level: "intermediate", nodeIds: ["merge"], status: "ready", createdAt: iso(3), stepsReady: 1, stepsTotal: 1, sourcesStale: false, supersededBy: null, learnerStatus: "not_started", video: null, practice: null },
      { id: "l-git-rebase", topicId: "t-git", title: "Rebase", objective: "Move a branch onto a new base and resolve conflicts along the way.", level: "intermediate", nodeIds: ["rebase"], status: "failed", createdAt: iso(1), stepsReady: 1, stepsTotal: 4, sourcesStale: false, supersededBy: null, learnerStatus: "not_started", video: null, practice: null },
    ],
    sources: [{ id: "g1", url: "https://git-scm.com/book/en/v2", title: "Pro Git", kind: "book", note: "chapters 2–3", status: "ok" }],
    materials: [],
    conversations: convs("cg", [0, 3, 5, 10, 17, 24, 33, 38]),
    onboarding: [
      { key: "interview", label: "Interview", status: "done", detail: "goal: working in a team" },
      { key: "mission", label: "Mission", status: "done", detail: "MISSION.md written" },
      { key: "sources", label: "Sources", status: "done", detail: "1 source" },
      { key: "graph", label: "Knowledge map", status: "done", detail: "5 topics" },
      { key: "placement", label: "Level", status: "done", detail: "novice" },
    ],
  },
  "t-stretch": {
    topic: { id: "t-stretch", slug: "stretch", title: "Back stretches", createdAt: iso(0, 8), dueCards: 0, nodesMastered: 0, nodesTotal: 0, running: true, kind: "topic", goalId: null, plan: null, final: null },
    nodes: [],
    plan: [],
    goal: null,
    goalNotes: [],
    lessons: [],
    sources: [],
    materials: [],
    conversations: [{ id: "c-onb-stretch", kind: "onboard", lessonId: null, createdAt: iso(0, 8) }],
    onboarding: [
      { key: "interview", label: "Interview", status: "done", detail: "goal: relieve lower back pain" },
      { key: "mission", label: "Mission", status: "done", detail: "MISSION.md written" },
      { key: "sources", label: "Sources", status: "active", detail: "searching for sources" },
      { key: "graph", label: "Knowledge map", status: "pending", detail: null },
      { key: "placement", label: "Level", status: "pending", detail: null },
    ],
  },
  "t-goal": {
    topic: { id: "t-goal", slug: "goal", title: "Workout tracking app", createdAt: iso(41), dueCards: 0, nodesMastered: 0, nodesTotal: 0, running: false, kind: "goal", goalId: null, plan: { total: 0, opened: 0 }, final: null },
    nodes: [],
    plan: [],
    goal: null,
    goalNotes: [],
    lessons: [],
    sources: [],
    materials: [],
    conversations: [{ id: "c-goal", kind: "onboard", lessonId: null, createdAt: iso(41) }],
    onboarding: [
      { key: "interview", label: "Interview", status: "done", detail: "I log a workout in under a minute" },
      { key: "plan", label: "Course plan", status: "done", detail: "6 courses" },
    ],
  },
};

/** A goal's course plan; an entry with a topic id is opened. */
export function goalPlan(entries: [stage: string, id: string, title: string, why: string, topicId?: string][]): TopicDetail["plan"] {
  return entries.map(([stage, id, title, why, topicId]) => ({ id, stage, title, why, topic: topicId ? (topicDetails[topicId]?.topic ?? null) : null }));
}

export const GOAL_PLAN: Parameters<typeof goalPlan>[0] = [
  ["A working prototype", "computer-basics", "Files, folders and the terminal", "Run the tools an app needs without fear of breaking the computer."],
  ["A working prototype", "git", "Git basics", "Keep every version of the app and roll back a change that broke it.", "t-git"],
  ["A working prototype", "app-structure", "How a mobile app works: screens, state, navigation", "Understand the code an AI assistant writes for your screens and fix it."],
  ["Data that survives a restart", "data-storage", "Storing data on the device", "Keep the workout log when the app closes."],
  ["Friends can install it", "deploy", "Building and publishing an app", "Get the app from your laptop onto a friend's phone."],
  ["Friends can install it", "accounts-keys", "Developer accounts, keys and costs", "Know what the stores require and what it costs before you publish."],
];

topicDetails["t-goal"]!.plan = goalPlan(GOAL_PLAN);
topicDetails["t-goal"]!.topic.plan = { total: GOAL_PLAN.length, opened: 1 };
topicDetails["t-goal"]!.goalNotes = [
  { id: "gn-1", text: "Writes code only through an AI assistant, not by hand.", topicId: "t-git", topicTitle: "Git basics", createdAt: iso(2) },
];

// ---------- Conversations ----------

export const conversations: Record<string, { topicId: string; kind: TopicDetail["conversations"][number]["kind"]; messages: ChatMessage[] }> = {
  "c-onb-bayes": {
    topicId: "t-bayes",
    kind: "onboard",
    messages: [
      { id: "m1", role: "user", text: "I want to understand Bayesian statistics so I can read A/B test results at work.", createdAt: iso(20) },
      { id: "m2", role: "activity", text: "Reading the request", doneText: "Read the request", createdAt: iso(20) },
      { id: "m3", role: "assistant", text: "Great goal. To pick the right level, tell me: where would you start if you had to find the probability of disease after a positive test, given the test's [[sensitivity|Sensitivity]]?", createdAt: iso(20) },
      {
        id: "m4",
        role: "ask",
        text: "What is the first step?",
        options: [{ label: "Take the test's accuracy", description: "for example, 90%" }, { label: "Check how common the disease is" }, { label: "I don't know where to start" }],
        multi: false,
        allowFree: true,
        createdAt: iso(20),
      },
      { id: "m5", role: "user", text: "Take the test's accuracy", createdAt: iso(20) },
      { id: "m6", role: "activity", text: "Searching for sources", doneText: "Found sources", createdAt: iso(20) },
      { id: "m7", role: "activity", text: "Checking quotes in Think Bayes", doneText: "Checked quotes in Think Bayes", createdAt: iso(20) },
      { id: "m8", role: "activity", text: "Building the knowledge map", doneText: "Built the knowledge map", createdAt: iso(20) },
      {
        id: "m9",
        role: "assistant",
        text: "Got it. We'll start with **conditional probability** and the difference between P(A | B) and P(B | A): that is exactly where the test's accuracy is easy to mistake for the answer.\n\nI gathered three sources and a map of 8 nodes. The first lesson covers conditional probability, the second Bayes' theorem through a medical test.",
        createdAt: iso(20),
      },
    ],
  },
  "c-goal": {
    topicId: "t-goal",
    kind: "onboard",
    messages: [
      { id: "g1", role: "user", text: "I want to make a mobile app to track my workouts.", createdAt: iso(41) },
      { id: "g2", role: "assistant", text: "Good goal. What should the first version let you do?", createdAt: iso(41) },
      {
        id: "g3",
        role: "ask",
        text: "What is the smallest version that would already help you?",
        options: [{ label: "Log a workout in under a minute" }, { label: "See progress on a chart" }, { label: "Share workouts with a friend" }],
        multi: false,
        allowFree: true,
        createdAt: iso(41),
      },
      { id: "g4", role: "user", text: "Log a workout in under a minute", createdAt: iso(41) },
      { id: "g5", role: "activity", text: "Updating the mission", doneText: "Updated the mission", createdAt: iso(41) },
      { id: "g6", role: "activity", text: "Planning the courses", doneText: "Planned the courses", createdAt: iso(41) },
      {
        id: "g7",
        role: "assistant",
        text: "The plan has **6 courses** in three stages: a working prototype, data that survives a restart, and an app your friends can install. At 4 hours a week that is about 4 months.\n\nOpen the first course from the plan. If you want to change it, tell me here.",
        createdAt: iso(41),
      },
    ],
  },
  "c-onb-stretch": {
    topicId: "t-stretch",
    kind: "onboard",
    messages: [
      { id: "s1", role: "user", text: "Back stretches: I sit for 8 hours a day and my lower back hurts.", createdAt: iso(0, 8) },
      { id: "s2", role: "activity", text: "Reading the request", doneText: "Read the request", createdAt: iso(0, 8) },
      { id: "s3", role: "assistant", text: "Got it. What matters most to you?", createdAt: iso(0, 8) },
      {
        id: "s4",
        role: "ask",
        text: "Which goal is closest?",
        options: [{ label: "Relieve lower back pain" }, { label: "Become more flexible" }, { label: "A warm-up for desk work" }],
        multi: false,
        allowFree: true,
        createdAt: iso(0, 8),
      },
      { id: "s5", role: "assistant", text: "Pick an option or describe it in your own words.", createdAt: iso(0, 8) },
      { id: "s6", role: "user", text: "Relieve lower back pain", createdAt: iso(0, 8) },
      { id: "s7", role: "activity", text: "Updating the mission", doneText: "Updated the mission", createdAt: iso(0, 8) },
      { id: "s8", role: "activity", text: "Searching for sources", doneText: "Found sources", createdAt: iso(0, 8) },
    ],
  },
};

// ---------- Cards, review, memory, notes, audit ----------

export const cards: CardView[] = [
  { id: "cd1", topicId: "t-bayes", kind: "basic", front: "What is a test's [[sensitivity|Sensitivity]]?", back: "P(test+ | sick): the share of positive results among the sick.", nodeId: "bayes-theorem", status: "active", due: iso(0), lapses: 9 },
  { id: "cd2", topicId: "t-bayes", kind: "cloze", front: "P(A | B) = P(A and B) / ____", back: "P(B)", nodeId: "cond-prob", status: "active", due: iso(0), lapses: 3 },
  { id: "cd3", topicId: "t-bayes", kind: "basic", front: "Why is a positive test for a rare disease often false?", back: "Healthy people far outnumber the sick, so even a small share of false alarms among them exceeds the number of detections.", nodeId: "base-rate", status: "active", due: iso(0), lapses: 1 },
  { id: "cd4", topicId: "t-git", kind: "basic", front: "What does git merge --no-ff do?", back: "Always creates a merge commit, even when a fast-forward is possible.", nodeId: "merge", status: "active", due: iso(0), lapses: 4 },
  { id: "cd5", topicId: "t-git", kind: "basic", front: "Where are changes stored after git add?", back: "In the index (staging area).", nodeId: "staging", status: "active", due: iso(-3), lapses: 0 },
  { id: "pc1", topicId: "t-bayes", kind: "basic", front: "What does P(sick | test+) show?", back: "The probability of disease for a person with a positive test result.", nodeId: "bayes-theorem", status: "proposed", due: null, lapses: 0 },
  { id: "pc2", topicId: "t-bayes", kind: "cloze", front: "The denominator of Bayes' formula is ____, the probability of a positive test across everyone.", back: "P(test+)", nodeId: "bayes-theorem", status: "proposed", due: null, lapses: 0 },
  { id: "pc3", topicId: "t-bayes", kind: "basic", front: "How does prevalence affect P(sick | test+)?", back: "The more common the disease, the higher the probability of disease after a positive test.", nodeId: "base-rate", status: "proposed", due: null, lapses: 0 },
];

export const reviewItems: PublicItem[] = [
  item(
    "r2",
    { format: "single", prompt: "A test's sensitivity is 90%. Which probability equals 90%?", bloom: "understand", options: [{ text: "P(sick | test+)" }, { text: "P(test+ | sick)" }, { text: "P(sick)" }] },
    { correct: 1, optionFeedback: ["That is the inverse probability: the chance of disease given a positive result.", "Correct.", "That is the prevalence."], solution: "Sensitivity is computed among the sick: P(test+ | sick).", correctAnswer: "P(test+ | sick)", hints: [] },
  ),
  item(
    "r1",
    { format: "single", prompt: "Besides the test's characteristics, which number do you need to find P(sick | test+)?", bloom: "remember", options: [{ text: "Prevalence of the disease" }, { text: "Number of people tested" }, { text: "Price of the test" }] },
    { correct: 0, optionFeedback: ["Correct.", "The number of people tested scales every group equally.", "The price does not affect the probability."], solution: "You need the prior probability, which is the prevalence.", correctAnswer: "Prevalence of the disease", hints: [] },
  ),
];

/** Review items that return because the learner was sure of a wrong answer to them; listed first, as the server does. */
export const reviewRetests = ["r2"];

// ---------- Practice test pool: graded items of the finished Bayes lessons ----------

export type PracticeSource = { item: PublicItem; nodeId: string; lessonId: string };

const practiceItem = (id: string, nodeId: string, lessonId: string, pub: Omit<PublicItem, "id" | "hintCount">, key: Omit<Key, "kind" | "hints">): PracticeSource => ({
  item: item(id, pub, { ...key, hints: [] }),
  nodeId,
  lessonId,
});

export const practicePool: PracticeSource[] = [
  practiceItem(
    "pt1",
    "prob-basics",
    "l-cond",
    { format: "single", prompt: "A fair die is rolled once. What is the probability of an even number?", bloom: "apply", options: [{ text: "1/6" }, { text: "1/2" }, { text: "1/3" }] },
    { correct: 1, optionFeedback: ["That is the chance of one particular face.", "Yes: 3 of the 6 equally likely faces are even.", "That would be two faces out of six."], solution: "Even faces are 2, 4 and 6: **3 / 6 = 1/2**.", correctAnswer: "1/2" },
  ),
  practiceItem(
    "pt2",
    "prob-basics",
    "l-cond",
    { format: "number", prompt: "Two fair coins are tossed. What is the probability that both land heads? Give a decimal.", bloom: "apply" },
    { correct: 0.25, tolerance: 0.001, solution: "The tosses are independent: 0.5 × 0.5 = **0.25**.", correctAnswer: "0.25" },
  ),
  practiceItem(
    "pt3",
    "prob-basics",
    "l-cond",
    { format: "cloze", prompt: "Fill in the blanks.", bloom: "remember", text: "A probability is never below {{1}} and never above {{2}}.", blankCount: 2 },
    { correct: [["0", "zero"], ["1", "one"]], solution: "Probabilities run from **0** (impossible) to **1** (certain).", correctAnswer: "1: 0; 2: 1" },
  ),
  practiceItem(
    "pt4",
    "cond-prob",
    "l-cond",
    { format: "single", prompt: "Of 200 employees, 80 work remotely and 20 of the remote workers are managers. What is P(manager | remote)?", bloom: "apply", options: [{ text: "20/200" }, { text: "20/80" }, { text: "80/200" }] },
    { correct: 1, optionFeedback: ["That is the joint probability over all employees.", "Yes: the condition narrows the group to the 80 remote workers.", "That is the share of remote workers."], solution: "The condition \"remote\" leaves 80 people, 20 of them managers: **20/80 = 0.25**.", correctAnswer: "20/80" },
  ),
  practiceItem(
    "pt5",
    "cond-prob",
    "l-cond",
    { format: "multi", prompt: "Which statements about P(A | B) are true?", bloom: "understand", options: [{ text: "It is P(A and B) divided by P(B)" }, { text: "It always equals P(B | A)" }, { text: "It only looks at cases where B happened" }] },
    { correct: [0, 2], solution: "Conditioning on B keeps the cases where B happened; P(A | B) and P(B | A) differ in general.", correctAnswer: "1 and 3" },
  ),
  practiceItem(
    "pt6",
    "cond-prob",
    "l-cond",
    { format: "short", prompt: "In your own words: why is P(sick | positive) not the same as P(positive | sick)?", bloom: "understand" },
    { correct: null, accept: /group|among|condition/i, solution: "They condition on different groups: one counts the sick **among people who tested positive**, the other the positives **among the sick**.", correctAnswer: "They count within different groups: the positives versus the sick." },
  ),
  practiceItem(
    "pt7",
    "bayes-theorem",
    "l-bayes-v1",
    { format: "order", prompt: "Put the steps of a natural-frequency calculation in order.", bloom: "apply", entries: ["Count the positives among the healthy", "Picture 1000 people", "Divide true positives by all positives", "Count the sick and their positives"] },
    {
      correct: ["Picture 1000 people", "Count the sick and their positives", "Count the positives among the healthy", "Divide true positives by all positives"],
      solution: "Start from a concrete group, split it by the condition, count each kind of positive, then take the share.",
      correctAnswer: "Picture 1000 → sick positives → healthy positives → divide",
    },
  ),
  practiceItem(
    "pt8",
    "bayes-theorem",
    "l-bayes-v1",
    { format: "number", prompt: "Of 1000 people, 10 are sick; the test detects 9 of them and fires for 89 healthy people. What share of positives are sick, in percent?", bloom: "apply", unit: "%" },
    { correct: 9.2, tolerance: 0.3, solution: "9 true positives out of 9 + 89 = 98 positives: **9 / 98 ≈ 9.2%**.", correctAnswer: "≈ 9.2 %" },
  ),
  practiceItem(
    "pt9",
    "bayes-theorem",
    "l-bayes-v1",
    { format: "single", prompt: "Which term of Bayes' formula is the prior?", bloom: "remember", options: [{ text: "P(sick)" }, { text: "P(positive | sick)" }, { text: "P(sick | positive)" }] },
    { correct: 0, optionFeedback: ["Yes: the probability before the test result.", "That is the likelihood of the result.", "That is the posterior, what we compute."], solution: "The prior is the probability before the evidence: **P(sick)**, the prevalence.", correctAnswer: "P(sick)" },
  ),
  practiceItem(
    "pt10",
    "base-rate",
    "l-bayes-v1",
    { format: "single", prompt: "A screening test is used in a population where the disease becomes ten times more common. What happens to P(sick | positive)?", bloom: "analyze", options: [{ text: "It rises" }, { text: "It stays the same" }, { text: "It falls" }] },
    { correct: 0, optionFeedback: ["Yes: true positives grow while false alarms among the healthy barely change.", "The test is the same, but the groups it sorts are not.", "More sick people means more true positives, not fewer."], solution: "With a higher base rate, true positives make up a larger share of all positives, so the posterior **rises**.", correctAnswer: "It rises" },
  ),
  practiceItem(
    "pt11",
    "base-rate",
    "l-bayes-v1",
    { format: "cloze", prompt: "Fill in the blank.", bloom: "understand", text: "Ignoring how common a condition is when judging a positive result is the {{1}} fallacy.", blankCount: 1 },
    { correct: [["base rate", "base-rate"]], solution: "It is the **base rate fallacy**: the prevalence is left out of the judgement.", correctAnswer: "base rate" },
  ),
  practiceItem(
    "pt12",
    "base-rate",
    "l-bayes-v1",
    { format: "multi", prompt: "Which numbers do you need to find P(sick | positive)?", bloom: "apply", options: [{ text: "Prevalence" }, { text: "Sensitivity" }, { text: "False positive rate" }, { text: "Price of the test" }] },
    { correct: [0, 1, 2], solution: "Prevalence, sensitivity and the false positive rate fix all four groups; the price plays no part.", correctAnswer: "1, 2 and 3" },
  ),
];

export const memoryFiles: Record<string, MemoryFile[]> = {
  "t-bayes": [
    {
      path: "MISSION.md",
      updatedAt: iso(20),
      content:
        "# Mission: Bayesian statistics\n\n## Why\n\nRead A/B test results at work and understand what \"the probability that B beats A\" means.\n\n## Success means\n\nCan explain an A/B test report to the team without mixing up P(A | B) and P(B | A).\n\n## Constraints\n\nA few short sessions a week.\n\n## Already know\n\nNew to statistics; comfortable with percentages.\n\n## Interests and context\n\nProduct analytics, marketing.\n\n## Out of scope\n\nFormal proofs.",
    },
    { path: "GLOSSARY.md", updatedAt: iso(9), content: "# Glossary\n\n| Term | Meaning |\n|---|---|\n| Prior probability | Estimate before observing the data |\n| Likelihood | P(data \\| hypothesis) |\n| Posterior probability | Estimate after the data |" },
    { path: "NOTES.md", updatedAt: iso(1), content: "# Notes\n\n- Mixes up P(A|B) and P(B|A) in \"among\" phrasings.\n- Natural frequencies work well." },
    { path: "RESOURCES.md", updatedAt: iso(20), content: "# Resources\n\n1. [Think Bayes](https://allendowney.github.io/ThinkBayes2/), chapters 1–4\n2. Gigerenzer & Hoffrage, 1995" },
    { path: "learning-records/2026-09-24.md", updatedAt: iso(9), content: "# Lesson \"Conditional probability\"\n\nCheck: 3 of 4. Mistake on the P(A and B) problem." },
  ],
  "t-git": [
    {
      path: "MISSION.md",
      updatedAt: iso(40),
      content:
        "# Mission: Git basics\n\n## Why\n\nWork confidently with branches in a team.\n\n## Success means\n\nCreates branches, merges them and resolves a simple conflict without help.\n\n## Constraints\n\nNone stated.\n\n## Already know\n\nCommits and staging.\n\n## Interests and context\n\nTeam work on a shared repository.\n\n## Out of scope\n\nGit internals.",
    },
  ],
  "t-stretch": [],
};

export const notes: NoteView[] = [
  { id: "n1", topicId: "t-bayes", lessonId: "l-cond", stepId: "cs-1", quote: "Conditional probability is the joint probability divided by the probability of the condition", text: "Remember: divide by the condition, not by everything.", createdAt: iso(9) },
];

export const audit: AuditEntry[] = [
  {
    itemId: "c1",
    topicTitle: "Bayesian statistics",
    item: {
      format: "single",
      prompt: "The test's sensitivity is 90%. What exactly equals 90%?",
      bloom: "understand",
      options: [
        { text: "P(test+ | sick)", feedback: "Correct." },
        { text: "P(sick | test+)", misconception: "Confuses forward and inverse probability", feedback: "That is the inverse probability." },
        { text: "P(sick)", misconception: "Confuses a property of the test with prevalence", feedback: "That is the prevalence." },
      ],
      correct: 0,
      solution: "Sensitivity is P(test+ | sick).",
      hints: ["Sensitivity describes the test.", "Within which group is the share computed?"],
    },
    gate: [
      { stage: "schema", rule: "S1", pass: true, message: "" },
      { stage: "deterministic", rule: "Q4", pass: true, message: "Key is 1.0× the mean distractor length" },
      { stage: "quotes", rule: "Q6", pass: true, message: "Quote found in source s1" },
      { stage: "critic", rule: "Q1", pass: true, message: "Blind solve matched the key" },
      { stage: "critic", rule: "Q2", pass: true, message: "The key cannot be guessed from the options" },
    ],
  },
  {
    itemId: "p2",
    topicTitle: "Bayesian statistics",
    item: { format: "number", prompt: "The disease affects 2% of people, sensitivity is 95%, the false positive rate 5%. Find P(sick | test+).", bloom: "apply", answer: 28, tolerance: 1, unit: "%", solution: "19 / 68 ≈ 28%." },
    gate: [
      { stage: "schema", rule: "S1", pass: true, message: "" },
      { stage: "critic", rule: "Q1", pass: true, message: "Blind solve: 27.9%" },
      { stage: "critic", rule: "L16", pass: false, message: "The problem context is not tied to the interests in MISSION (A/B tests); skipped on resubmission" },
    ],
  },
  {
    itemId: "c2m",
    topicTitle: "Bayesian statistics",
    item: {
      format: "match",
      prompt: "Match each probability from the test example to what it describes.",
      bloom: "understand",
      pairs: [
        { left: "P(test+ | sick)", right: "The test's sensitivity", mistake: { misconception: "Reads the bar backwards: takes the share among the positives", feedback: "The part after the bar names the group; this share is computed among the sick." } },
        { left: "P(sick)", right: "The prevalence of the disease" },
        { left: "P(test+ | healthy)", right: "The false positive rate" },
        { left: "P(sick | test+)", right: "The share of positives who are actually sick", mistake: { misconception: "Confuses forward and inverse probability", feedback: "The group here is everyone who tested positive." } },
      ],
      distractors: [{ text: "The share of healthy people who test negative", misconception: "Confuses the false positive rate with specificity", feedback: "A positive result in a healthy person is a false alarm, not a correct negative." }],
      solution: "P(test+ | sick) is the sensitivity, P(sick) the prevalence, P(test+ | healthy) the false positive rate, and P(sick | test+) the share of positives who are actually sick.",
      hints: ["Read the part after the bar first.", "Only one of the four is computed among the positives."],
    },
    gate: [
      { stage: "schema", rule: "S1", pass: true, message: "" },
      { stage: "deterministic", rule: "Q1", pass: true, message: "ok" },
      { stage: "deterministic", rule: "Q4", pass: true, message: "ok" },
      { stage: "critic", rule: "Q1", pass: true, message: "Blind solve agrees with the key" },
      { stage: "critic", rule: "L8", pass: true, message: "items.1.distractors.0: The distractor fits no entry and names a common confusion" },
    ],
  },
];

// ---------- Learner progress, activity, weak spots ----------

/** Progress already on the server when the lesson opens, so a reload shows restored state. */
export const itemStates: Record<string, ItemState> = {
  a1: {
    attempts: 1,
    wrongAttempts: 0,
    solved: false,
    gaveUp: false,
    hints: [],
    lastFeedback: "Close to intuition, but the rarity of the disease pulls the answer down.",
    lastConfidence: null,
    solution: "Of 1000 people, 10 are sick and the test detects 9. Of the 990 healthy, the test wrongly fires for 89. That makes 98 positives, 9 of them sick: **9 / 98 ≈ 9%**.",
    correctAnswer: "About 9%",
  },
  c1: {
    attempts: 1,
    wrongAttempts: 1,
    solved: false,
    gaveUp: false,
    hints: ["Sensitivity describes the test, not the patient holding a result."],
    lastFeedback: "That is the inverse probability: it is what we are looking for, and it does not equal the sensitivity.",
    lastConfidence: "sure",
  },
};

export const revealedLines: Record<string, { idx: number; text: string }[]> = {};

/** Canned "Explain differently" answers; a lens asked again gets its next variant. */
export const alternativeBodies: Record<ExplainLens, string[]> = {
  simpler: [
    "We only look at the cases where the condition is true, and ask how often the event happens **among them**.\n\nThat is all [[conditional probability|Conditional probability]] means: shrink the world to the condition, then count again.",
  ],
  analogy: [
    "Think of an online shop's purchase funnel.\n\n- All visitors are the whole world: P(A and B) counts visitors who **both** opened the cart (B) **and** paid (A), out of everyone.\n- P(A | B) asks a different question: of the visitors who opened the cart, what share paid? You divide by the cart visitors only.\n\nThe analogy stops fitting when the condition is not something you can watch happen first, like a hidden illness behind a test result.",
    "Picture a newsletter: of 1,000 subscribers, 200 open an email and 50 of those click a link.\n\nThe share of **all** subscribers who opened and clicked is 50 / 1,000, a [[joint probability|Joint probability]]. The share of **openers** who clicked is 50 / 200: you changed who counts as everyone.\n\nThe picture breaks down when the groups overlap in ways a funnel does not show.",
  ],
  steps: [
    "1. Write down the condition B: the group you are told about.\n2. Keep only the cases inside B; the rest no longer matter.\n3. Among those, find the cases where A also happens: that is P(A and B).\n4. Divide by the size of the group you kept, P(B).\n5. The result, P(A | B), answers \"how often A, given B\".",
  ],
  example: [
    "Over 100 days, 30 were rainy, and on 12 of the rainy days your bus was late.\n\nAsked \"on what share of all days was it rainy and the bus late?\", you divide by every day: 12 / 100.\n\nAsked \"on what share of the rainy days was the bus late?\", the rainy days become your whole world: 12 / 30.\n\nThe second question is a [[conditional probability|Conditional probability]]: the condition decides what you divide by.",
  ],
  precise: [
    "For events A and B with P(B) > 0, [[conditional probability|Conditional probability]] is defined as P(A | B) = P(A and B) / P(B).\n\n- The numerator is the [[joint probability|Joint probability]] of A and B.\n- Dividing by P(B) rescales the probabilities inside B so that they add up to 1: B becomes the new sample space.\n- When P(B) = 0 the ratio is undefined, which is why the condition must be possible.",
  ],
};

export const alternatives: Record<string, AlternativeView[]> = {
  "cs-1": [{ id: "alt-seed", lens: "simpler", body: alternativeBodies.simpler[0]!, createdAt: iso(9) }],
};

/** Minutes per day for the last `days` days, oldest first; a fixed pattern with rest days. */
export function activity(days: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const seed = (d.getDate() * 37 + d.getMonth() * 11) % 10;
    const rest = i > 0 && (seed < 3 || i > 45);
    const minutes = rest ? 0 : 6 + ((seed * 7) % 38);
    const attempts = rest ? 0 : Math.round(minutes / 3);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date, attempts, correct: Math.round(attempts * 0.7), reviews: rest ? 0 : seed % 4, minutes });
  }
  return out;
}

const localDay = (daysAgo: number) => iso(daysAgo).slice(0, 10);

export const today: TodayView = {
  streak: { days: 12, best: 19, activeToday: true, freezes: 1, nextFreezeIn: 2, frozen: [localDay(4)] },
  goal: { minutes: 10, done: 7 },
  advanced: [{ topicId: "t-bayes", nodeId: "cond-prob", title: "Conditional probability", mastery: "exit_passed" }],
  nextReview: { date: localDay(-1), cards: 6 },
  mistakes: { open: 4, ready: 3 },
};

const level = (confidence: "guess" | "unsure" | "sure", correct: number, attempts: number) => ({ confidence, correct, attempts });

export const calibration: CalibrationView = {
  overall: [level("guess", 8, 20), level("unsure", 17, 28), level("sure", 45, 50)],
  topics: [
    { topicId: "t-bayes", title: "Bayesian statistics", levels: [level("guess", 7, 17), level("unsure", 13, 22), level("sure", 34, 37)] },
    { topicId: "t-git", title: "Git basics", levels: [level("guess", 1, 3), level("unsure", 4, 6), level("sure", 11, 13)] },
  ],
};

export const weak: WeakSpot[] = [
  { kind: "card", cardId: "cd1", topicId: "t-bayes", nodeId: "bayes-theorem", front: "What is a test's sensitivity?", lapses: 9 },
  {
    kind: "item",
    itemId: "p2",
    topicId: "t-bayes",
    lessonId: "l-bayes",
    nodeId: "bayes-theorem",
    prompt: "The disease affects 2% of people, sensitivity is 95%, the false positive rate 5%. Find P(sick | test+).",
    wrongAttempts: 3,
    lastMisconception: "only the positives among the sick in the denominator",
  },
  { kind: "card", cardId: "cd4", topicId: "t-git", nodeId: "merge", front: "What does git merge --no-ff do?", lapses: 4 },
];

// ---------- Mistakes notebook ----------

function bayesItem(id: string): PublicItem {
  for (const st of bayesSteps) {
    const list = !st ? [] : st.kind === "explain" ? st.checks : st.kind === "practice" ? [st.item] : st.kind === "activate" || st.kind === "check" ? st.items : [];
    const found = list.find((i) => i.id === id);
    if (found) return found;
  }
  throw new Error(`no mock item ${id}`);
}

const gitMergeItem = item(
  "gm1",
  {
    format: "single",
    prompt: "You run `git merge feature` and get a conflict in `app.js`. What state is the repository in?",
    bloom: "understand",
    options: [{ text: "The merge is paused until you resolve the conflict and commit" }, { text: "Git has already made the merge commit, with conflict markers in it" }, { text: "The merge was cancelled and nothing changed" }],
  },
  {
    correct: 0,
    optionFeedback: ["Right: Git waits for you to resolve the conflict and finish with a commit.", "Git makes no merge commit while a conflict is unresolved.", "The merge is not cancelled: the files with conflicts wait for you."],
    solution: "A conflict pauses the merge: the conflicting files carry markers, `git status` lists them, and the merge ends with your commit (or `git merge --abort`).",
    correctAnswer: "The merge is paused until you resolve the conflict and commit",
    hints: [],
  },
);

const bayesEntry = (itemId: string, nodeId: string, nodeTitle: string, stepIdx: number) => ({
  itemId,
  topicId: "t-bayes",
  topicTitle: "Bayesian statistics",
  nodeId,
  nodeTitle,
  lessonId: "l-bayes",
  lessonTitle: "Bayes' theorem through a medical test",
  stepIdx,
  item: bayesItem(itemId),
});

/** Newest first, as the server sends them. */
export const mistakes: MistakeEntry[] = [
  { ...bayesEntry("p2", "bayes-theorem", "Bayes' theorem", 6), answer: "95 %", misconception: null, gaveUp: false, at: iso(0, 9), retries: 0, readyAt: iso(-1, 9), resolvedAt: null },
  { ...bayesEntry("k1", "bayes-theorem", "Bayes' theorem", 9), answer: "99%", misconception: "Takes the test's sensitivity for the probability of disease", gaveUp: false, at: iso(2), retries: 0, readyAt: iso(1), resolvedAt: null },
  { ...bayesEntry("c1", "cond-prob", "Conditional probability", 1), answer: "P(sick | test+)", misconception: "Confuses forward and inverse probability", gaveUp: false, at: iso(3), retries: 1, readyAt: iso(1, 9), resolvedAt: null },
  {
    itemId: "gm1",
    topicId: "t-git",
    topicTitle: "Git basics",
    nodeId: "merge",
    nodeTitle: "Merging and conflicts",
    lessonId: "l-git",
    lessonTitle: "Branching and merging",
    stepIdx: null,
    item: gitMergeItem,
    answer: "Git has already made the merge commit, with conflict markers in it",
    misconception: "Thinks Git commits a merge before its conflicts are resolved",
    gaveUp: false,
    at: iso(4),
    retries: 0,
    readyAt: iso(3),
    resolvedAt: null,
  },
  { ...bayesEntry("p1", "base-rate", "Base rate fallacy", 4), answer: null, misconception: null, gaveUp: true, at: iso(6), retries: 2, readyAt: iso(4), resolvedAt: iso(4, 12) },
];

/** Confirmed misconceptions; the mock shows those whose entry is still open. */
export const mistakePatterns: MistakePattern[] = [
  { itemId: "c1", topicId: "t-bayes", nodeTitle: "Conditional probability", option: "P(sick | test+)", misconception: "Confuses forward and inverse probability", times: 2 },
];

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const bootedAt = secondsAgo(3 * 3600 + 17 * 60);

export const system = (): SystemView => ({
  backend: { pid: 48213, startedAt: bootedAt, bun: "1.3.6", port: 4317, rssMb: 182, heapMb: 41.3, cpuPercent: 2.4, dbMb: 6.8, model: "opus", criticModel: "sonnet", maxBudgetUsd: 5 },
  frontend: { builtAt: null, streams: 2 },
  instances: [
    { pid: 51022, kind: "onboard", model: "opus", effort: "medium", startedAt: secondsAgo(214), conversationId: "c-onb-stretch", topicId: "t-stretch", topicTitle: "Back stretches", lessonId: null, activities: ["Reading a page", "Searching for sources"], queued: 0, rssMb: 246, cpuPercent: 7.9 },
    { pid: 51388, kind: "lesson", model: "opus", effort: "medium", startedAt: secondsAgo(96), conversationId: "c-ls-bayes", topicId: "t-bayes", topicTitle: "Bayesian statistics", lessonId: "l-bayes", activities: ["Building the knowledge map", "Planning the lesson"], queued: 1, rssMb: 231, cpuPercent: 12.1 },
    { pid: 51420, kind: "critic", model: "sonnet", effort: "high", startedAt: secondsAgo(11), conversationId: null, topicId: null, topicTitle: null, lessonId: null, activities: [], queued: 0, rssMb: 198, cpuPercent: 31.5 },
  ],
  finished: [
    { conversationId: "c-ls-git", kind: "lesson", topicId: "t-git", topicTitle: "Git basics", lessonId: null, startedAt: secondsAgo(900), finishedAt: secondsAgo(640), costUsd: 0.84, error: null, cancelled: false },
  ],
});

export const update: UpdateView = {
  version: "7c72939",
  commits: [
    { sha: "b41e0a2", subject: "feat: narrate lesson steps with ElevenLabs" },
    { sha: "9d3c7f1", subject: "feat: plan several courses toward one goal" },
    { sha: "52aa8e4", subject: "fix: keep the tutor context after a language switch" },
  ],
  blocked: null,
  state: "idle",
  running: 1,
  error: null,
};

// ---------- Glossary ----------

export const glossary: GlossaryEntry[] = [
  { topicId: "t-bayes", topicTitle: "Bayesian statistics", term: "Conditional probability", definition: "The probability of an event given that another event has happened, written P(A | B).", original: null, avoid: ["dependent probability"], updatedAt: iso(9) },
  { topicId: "t-bayes", topicTitle: "Bayesian statistics", term: "Joint probability", definition: "The probability that two events happen together, written P(A and B).", original: null, avoid: [], updatedAt: iso(9) },
  { topicId: "t-bayes", topicTitle: "Bayesian statistics", term: "Sensitivity", definition: "The share of positive results among the people who have the condition: P(test+ | sick).", original: "true positive rate", avoid: ["accuracy"], updatedAt: iso(5) },
  { topicId: "t-git", topicTitle: "Git basics", term: "Commit", definition: "A snapshot of the staging area saved in the repository.", original: null, avoid: ["save"], updatedAt: iso(30) },
];

/** The stored video of l-cond: two chapters with every kind of scene, over silent mock clips. */
export const condVideo: VideoTimeline = (() => {
  const cue = (text: string, at: number) => ({ text, at });
  return {
    duration: 71,
    clips: [
      { start: 0, duration: 8 },
      { start: 11.1, duration: 26 },
      { start: 40.2, duration: 18.2 },
      { start: 59, duration: 9 },
    ],
    chapters: [
      { title: "Joint and conditional probability", start: 8.6 },
      { title: "Reading it from a table", start: 37.7 },
    ],
    scenes: [
      {
        start: 0,
        screen: {
          kind: "intro",
          heading: "Conditional probability",
          subheading: "Tell **P(A | B)** apart from P(A and B) and read both from a table",
          chapters: [cue("Joint and conditional probability", 1.2), cue("Reading it from a table", 1.45)],
        },
      },
      { start: 8.6, screen: { kind: "chapter", number: 1, heading: "Joint and conditional probability" } },
      {
        start: 11.1,
        screen: {
          kind: "points",
          heading: "Two different questions",
          points: [cue("**Joint**: A and B both happen", 12.5), cue("**Conditional**: A, once B is known", 15), cue("Divide by `P(B)` to switch", 17.5)],
        },
      },
      { start: 20, screen: { kind: "statement", text: "Conditioning **narrows the world** to the cases where B happened.", note: "Everything else is set aside." } },
      {
        start: 26,
        screen: {
          kind: "figure",
          heading: "Keep only the cases where B happened",
          caption: "From all cases to the B cases",
          figure: {
            kind: "mermaid",
            code: "flowchart LR\n  All[All cases] --> B[B happened]\n  B --> AB[A and B]\n  B --> nA[B without A]",
            teaches: "Conditioning on B narrows the cases to those where B happened",
            alt: "All cases narrow to the cases where B happened, which split into A and B, and B without A.",
          },
        },
      },
      { start: 37.7, screen: { kind: "chapter", number: 2, heading: "Reading it from a table" } },
      {
        start: 40.2,
        screen: { kind: "block", heading: "The counts", markdown: "| | B | not B | total |\n|---|---|---|---|\n| A | 12 | 8 | 20 |\n| not A | 18 | 62 | 80 |\n| total | 30 | 70 | 100 |" },
      },
      { start: 46, screen: { kind: "block", heading: "The same in code", markdown: "```python\np_a_and_b = 12 / 100\np_b = 30 / 100\np_a_given_b = p_a_and_b / p_b  # 0.4\n```" } },
      {
        start: 51,
        screen: {
          kind: "example",
          heading: "From a table",
          problem: "30 of 100 people have B; 12 of them also have A. Find **P(A | B)**.",
          lines: [cue("Keep the 30 with B", 52), cue("12 of them have A", 54), cue("P(A | B) = 12 / 30 = **0.4**", 56)],
        },
      },
      {
        start: 59,
        screen: {
          kind: "summary",
          heading: "Key takeaways",
          points: [cue("Joint and conditional answer different questions", 60), cue("Conditioning keeps only the B cases", 62), cue("P(A | B) = P(A and B) / P(B)", 64)],
        },
      },
    ],
    captions: [
      { text: "Conditional probability answers a different question.", start: 0.3, end: 3.5 },
      { text: "A joint probability asks whether both things happen.", start: 11.3, end: 14.5 },
      { text: "Twelve of the thirty people with B also have A.", start: 52, end: 55 },
    ],
  };
})();
