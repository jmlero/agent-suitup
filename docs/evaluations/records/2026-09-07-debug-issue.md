# Evaluation: `skill/debug-issue`

- Date: 2026-09-07
- Evaluator: independent Codex agent in a separate context from the author
- Model/settings: inherited runtime defaults; exact build and sampling settings
  were not independently captured
- Fixture: synthetic dependency-free Node ESM cart quotes, described below
- Candidate: [canonical skill](../../../catalog/skills/debug-issue/SKILL.md),
  version `1.0.0`, original Apache-2.0 agent-suitup content
- Loading/cost: on demand; 426 normalized words, approximately 746 tokens
- Status: unpaired forward check; not recommendation evidence

## Hypothesis and boundaries

The skill should turn a concrete failure into a supported diagnosis and a
focused fix when requested. It must preserve diagnosis-only scope, qualify
missing evidence, and avoid unnecessary investigation for an obvious edit.
These are the observable criteria used to assess the cases below.

Diagnosis adds a workflow beyond TDD's implementation order, code audit's broad
review, and verify-work's execution of existing checks. The general practice of
testing competing explanations against observations is described in
[Google SRE's Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/).
That reference does not establish an improvement from installing this skill.

## Cases and observations

The evaluator received the skill, each request, and raw fixture details without
an intended diagnosis or proposed fix. Each executable case used a separate
temporary directory. There was one pass per case, no control without the skill,
no randomization, and no blinded scoring. Observations below summarize results;
full tool transcripts were not retained in the repository.

| Case | Request and supplied state | Observed outcome |
|---|---|---|
| Fix a regression | Investigate and fix order-dependent cart totals, preserve the exported interface and an unrelated draft. Source is below. | Reproduced both request orders and isolated region and quantity independently. Removed the cache while retaining both exports. Five regression tests had four failures before the fix and all five passed afterward; the unrelated draft was preserved. |
| Diagnosis only | Use the same original source; diagnose with evidence, without changing source or adding permanent tests. | Ran diagnostics through Node stdin, identified the cache key mismatch, and left the source hash and directory contents unchanged. |
| Missing runtime evidence | Only a gateway upstream-reset log at 14:02 and a successful retry are available; no service or additional logs can be accessed. | Left the cause unresolved, identified correlation with upstream and gateway logs as the next useful check, and made no speculative edits or retries. |
| Negative case | Correct `instal` to `install` in a temporary README. | Made the one-word edit and inspected the diff without invoking a debugging procedure or running unrelated tests. |

### Reproducible cart fixture

Documented behavior: `book` costs 1200 cents and `mug` costs 800 cents. Shipping
is charged once per quote: 200 cents for local, 700 for international. Quantity
is a positive integer and defaults to one. There is no performance requirement.
An unrelated `notes.md` contains `Keep my draft.`

```javascript
const cache = new Map();
export function quote({ sku, region, quantity = 1 }) {
  if (cache.has(sku)) return cache.get(sku);
  const unitCents = { book: 1200, mug: 800 }[sku];
  if (unitCents === undefined) throw new Error('Unknown SKU');
  const shippingCents = region === 'local' ? 200 : 700;
  const result = { totalCents: unitCents * quantity + shippingCents };
  cache.set(sku, result);
  return result;
}
export function clearQuotes() { cache.clear(); }
```

With a fresh module, quote a local book, then two international books. Observed
totals were 1400 and 1400, versus expected 1400 and 3100. Reversing the order
returned 3100 twice. Diagnostics used `node --input-type=module`; validation
used `node --test quote.test.mjs` on Node 26.8.1. The corrected implementation
computes each quote independently and retains `clearQuotes()` as a no-op.

## Decision and limits

**Retain** as an opt-in on-demand skill with no automatic catalog suggestion.
The bounded checks met the stated criteria without an observed material skill
defect. They demonstrate interpretation on a small fixture, not causal benefit,
coverage of intermittent failures, or real incident effectiveness. The cases
shared one evaluator context and did not exercise a live service.

Run the repository's paired protocol before claiming improved outcomes or
adding automatic suggestions. Shorten or remove the skill if the baseline
performs equivalently, or if representative use adds investigation overhead
without better diagnoses. Review missing-evidence and simple-edit cases when
changing the workflow. There are no added tool dependencies, remote package
updates, or always-loaded instruction blocks.
