# Contributing

Thanks for looking. This project is maintained by one person, so the most useful thing you
can do before writing code is **say what you intend to do**. A short issue costs you five
minutes and can save you a weekend.

---

## Before you write code

**Check [What it is not](README.md#what-it-is-not) first.** Some things are absent on
purpose — a queue, Redis, an object store, an integration catalogue, a drag-and-drop canvas.
A PR that adds one of those will be read carefully and probably still declined, and that is
a bad outcome for everyone. If you think one of those decisions is wrong, argue it in an
issue; that argument is welcome, the surprise PR is not.

**Open an issue for anything larger than a bug fix.** Describe the problem before the
solution. If a maintainer says "go ahead", that is your green light.

**Small fixes need no ceremony.** Typos, a wrong error message, a broken link — just send
the PR.

---

## Setting up

```bash
git clone https://github.com/afrizagilleon/zaatool.git
cd zaatool
pnpm install
```

You need Node 24, pnpm 11, and a Postgres you do not mind writing to. Copy `.env.example` to
`.env` and point it at that database.

```bash
pnpm dev            # engine and web together
pnpm dev:engine     # or one at a time
pnpm dev:web
```

Full detail, including phone testing and the HTTPS setup that audio recording needs, is in
[DEVELOPMENT.md](DEVELOPMENT.md).

**Always `pnpm`.** Never npm or yarn — the lockfile is pnpm's and a mixed lockfile is its
own afternoon.

---

## Before you open the PR

Run all four. All four have to pass.

```bash
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/web run build
pnpm test
pnpm --filter @zaa-tool/web run lint
```

**Both builds, not just the one you touched.** Tests run through `tsx` and `vitest`, which
strip types without checking them — a green suite does **not** prove the code compiles. This
has bitten this repo more than once, including once where the file that failed to compile
was a test file that had invented fields on a real type.

---

## What the code should look like

Match the file you are editing. Beyond that:

**TypeScript**
- No `any`. Use `unknown` and narrow it.
- `interface` for object shapes that get extended.
- Every async function handles its errors. No floating promises.

**Engine**
- Route handlers stay thin: validate → call a service → respond.
- Controllers do not touch the database. Services do not see `req`/`res`.
- Anything in `core/` stays pure — no Express, no SQL.
- New behaviour goes in a new file where it reasonably can. `registry` and `core/` are the
  extension points; editing the runner to special-case your thing is the wrong shape.
- No `console.log` on production paths.

**Web**
- Components never call `fetch()`. API traffic lives in a hook in `hooks/`.
- Notebook state lives in the Zustand store, not in component state.
- Tailwind classes only — no inline styles.
- Hooks are named `use[Domain][Action]`.

**Shared**
- Types only. No runtime logic, no side effects.
- If both engine and web need a type, it belongs here — not duplicated in each.

There is more of this, with the reasoning, in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Tests

New behaviour needs a test. Beyond that, three rules that exist because their absence cost
real time here:

**A test must be able to fail for the right reason.** Before you call it done, revert your
fix and watch the test go red. A test that passes either way is decoration, not coverage.

**A new component needs a caller.** Component tests render the component with props you
supply by hand, so they pass perfectly for a feature that never appears on screen. This
repo shipped three such features at once. `grep` for something that actually uses it:

```bash
grep -rn "YourComponent\|yourProp=" packages/*/src
```

**Fixtures are named `zz-…` and clean up after themselves.** Tests run against a real
Postgres that may also hold a real installation.

---

## Commits and PRs

- Short, semantic commit subjects: `fix(pages): …`, `feat(engine): …`, `docs: …`.
- One concern per PR. Two unrelated fixes are two PRs.
- Say in the description what you did **not** fix, if you noticed something and left it. A
  known gap named out loud is worth far more than a silent one.
- Do not add AI co-author trailers or generated-by footers to commits.

---

## Reporting bugs

Include:

1. What you did, step by step
2. What you expected
3. What happened instead
4. Version or commit, and how you are running it (Docker or source)
5. A screenshot, if it is visual

If it involves running a notebook, the notebook's text form (`notebook_read part: full`, or
the Export button) is the single most useful thing you can attach.

**Security issues do not go in the issue tracker.** Email the maintainer instead. Note that
notebooks run code on the server by design — that is documented, not a vulnerability. What
*is* worth reporting: anything that lets a `viewer` do what a `creator` can, anything that
leaks a secret's value, or anything reachable without authentication that should not be.

---

## Code of conduct

By taking part you agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). It is short.
