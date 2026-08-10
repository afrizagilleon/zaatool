<!--
Small fix (typo, wrong message, broken link)? Delete all of this and just say what you fixed.
-->

## What this changes

<!-- One or two sentences. What was wrong, and what it does now. -->

Closes #

## Checks

- [ ] `pnpm --filter @zaa-tool/engine run build` passes
- [ ] `pnpm --filter @zaa-tool/web run build` passes — **both builds**, tests do not type-check
- [ ] `pnpm test` passes
- [ ] `pnpm --filter @zaa-tool/web run lint` adds no new errors

## Tests

- [ ] I reverted my fix and watched the new test fail, then put it back

<!-- If you did not add a test, say why here. "It is a docs change" is a fine answer. -->

## If this adds a component, hook, or prop

- [ ] Something actually uses it — not only the test:

```
grep -rn "MyComponent\|myProp=" packages/*/src
```

<!-- Paste the result. A component test passes perfectly for a feature that never renders. -->

## What I did not fix

<!--
Anything you noticed and deliberately left alone. This is a real section, not a formality —
a gap named out loud is worth more than a silent one.
-->
