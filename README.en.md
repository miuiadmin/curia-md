# Curia MD

> Curia 2.2 — a portable documentation management scheme: two roots, 9 document types, 3-line header blocks, a zero-dependency checker, and a scaffold. Humans and AI agents read and write by the same rules.

**English** | [简体中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node ≥ 18](https://img.shields.io/badge/Node-%E2%89%A518-5FA04E.svg)](https://nodejs.org/)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**Contents**: [What it is](#what-it-is) · [Who it is for](#who-it-is-for) · [Core design](#core-design) · [Install](#install) · [Verify the install](#verify-the-install) · [Adopting into an existing repository](#adopting-into-an-existing-repository) · [FAQ](#faq) · [For maintainers](#for-the-people-maintaining-this-package)

> Chinese is the default language and the authoritative version of the maintenance contract. This English edition is a section-by-section translation; where they differ, the Chinese version prevails. The generator and checker print Chinese messages — quoted output below is rendered in English for readability, and the Chinese README shows the exact strings.

## What it is

Curia 2.2 is a portable documentation management scheme: two roots — `.agents/` holds process and institution (plans, research, decision notes, skills, archive), while `docs/` holds external facts and knowledge; 9 document types each have a home and a skeleton; typed documents carry a fixed 3-line header block; and one zero-dependency checker, `check-docs.mjs` (Node ≥ 18, no network), ships with it. Once adopted, where a document goes, what it looks like, how it is referenced, and how it retires are all written down; humans and agents read and write by the same rules.

`create-curia` is its local distribution package and generator: it copies the payload into your repository, creates three bridging symlinks (`CLAUDE.md`, `.claude/skills`, `.codex/skills` — so CLIs such as Claude Code and Codex read the rules and skills directly), and prints the next steps. It asks no questions, installs no hooks, and runs no script from the payload. One run and the tree is fork-and-own — the generated documentation tree is yours to maintain; this package has no resident `upgrade` / `check` subcommands.

Should you use it? Two questions decide. If you want project documents to have a fixed home and a fixed format, and you want humans and agents to write and search by the same rules — use it. If you are looking for a process engine, a gate system, an approval flow, or a permission model — those are not in Curia; the spec opens by stating that it is not a governance platform, process engine, or gate system. The cost of entry is low: with Node ≥ 18, run the generator; without it, copy the payload directly and adopt the text conventions only (see "Alternative: copy directly").

## Who it is for

**Good fit.**

- Multiple sessions (humans plus Claude Code / Codex and similar) write documents at the same time, and disagreements start about "where does this go, is that one stale?"
- You want a documentation structure that can be checked mechanically, without introducing a platform, service, database, or CI dependency.
- You accept fork-and-own: take a payload copy and maintain it at your own pace.

**Poor fit.**

- You need approval flows, permission models, release gates, a registry, or a process engine — Curia explicitly does not provide them.
- You want document generation, migration tooling, or bulk repairs — this package does none of these.
- The team has no documentation habit yet and expects a directory structure to solve collaboration on its own.

## Core design

### Two roots, capped at two

| Root | Holds | Does not hold |
|---|---|---|
| `.agents/` | Process and institution: plans, research, decision notes, skills, archive. | External fact registers, reader-facing published content. |
| `docs/` | Knowledge and external facts: registers and definitions for systems outside the repository (resource IDs, field mappings, endpoints, protocols); the current version is the single source of truth, with no state machine. | Plans and proposals, decision rationale, raw fact snapshots. |

The managed surface is capped at these two roots; no third root is added. A project may enable only one of them.

### Four rules of thumb

1. Not done yet → `plans/` (proposal / spec / plan)
2. Done → `research/` (survey / evidence / postmortem / reference)
3. Why → `notes/` (decision rationale, never in research)
4. Obsolete → flip the status first; cold history goes to `archive/` and is sealed; **never delete**

Also: reusable procedures → `skills/` (skill / runbook); external facts → root `docs/`.

### 9 document types

| Type | Home | What it is | Suggested sections |
|---|---|---|---|
| `proposal` | `plans/` | Alignment before work starts: why it is worth doing, what success looks like, which routes are candidates. | Background, goals, success criteria, options |
| `spec` | `plans/` | A long-lived contract: what it must be — fields, interfaces, acceptance criteria; `done` is not retirement. | Background, scope, contract, acceptance criteria, applicability |
| `plan` | `plans/` | The steps and how far they have gone; while `active`, "outstanding items" is the only active checklist. | Background, steps, outstanding items |
| `survey` | `research/` | One-off research: question, method, conclusions, and applicability. | Question, method and sources, conclusions, evidence and sources, applicability |
| `evidence` | `research/` | A raw fact snapshot: when, with what command, and what was seen. | Collected content, collection method, applicability |
| `postmortem` | `research/` | Incident review: timeline, causal chain, impact, prevention, action items. | Incident summary, timeline, impact, causal chain, prevention, action items |
| `reference` | `research/` | Long-lived factual reference: continuously maintained mappings and guides. | Fact mappings, method and sources, maintenance, applicability |
| `runbook` | `skills/` | A human-facing operating manual: prerequisites, steps, per-step verification, failure recovery. | Prerequisites, steps, verification, failure and recovery |
| `skill` | `skills/` | A workflow an agent loads on demand: frontmatter plus steps plus boundaries. | Steps, boundaries |

"Suggested sections" are skeleton defaults, not a machine quota; the checker does not verify section completeness. The type table is an upper bound, not a quota — a project dominated by short documents may drop types and suggested sections.

### 3-line header block

Typed documents (Markdown inside the `plans/`, `research/`, and `skills/` homes) carry a fixed three-line header, in this order:

```markdown
# <title>

Type: <one of the 9 types>
Status: <a value allowed for that type>
Updated: yyyy-mm-dd
```

`Status: superseded` must carry `Superseded-by: <relative link>`; archived documents must carry `Archived: yyyy-mm-dd`. Notes use a two-line header (title plus `Status:`); `docs/` has no header block. The full rules are in the payload's [`.agents/README.md`](./template/.agents/README.md).

### Checker

```bash
node .agents/tools/check-docs.mjs            # report mode: list findings, do not fail
node .agents/tools/check-docs.mjs --strict   # strict mode: fail on any finding
```

It checks only the mechanical subset: encoding, header block and lifecycle, home and naming, relative links. Zero dependencies, no network, no execution of code inside documents. **A passing check does not mean the documents are compliant** — section completeness, factual truth, conclusion quality, and freshness are outside the machine's judgment.

### Three bridges

The generator creates three bridging symlinks so different CLIs read the same rules and skills:

| Bridge | Points to | Read by |
|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Claude Code |
| `.claude/skills` | `../.agents/skills` | Claude Code |
| `.codex/skills` | `../.agents/skills` | Codex |

Bridges are pointers, not copies; change the rules only in `AGENTS.md` and `.agents/`.

## Install

The package is small: `bin/init.mjs` (the generator), `template/` (the payload: 21 files plus 3 bridging symlinks), `guide/` (design history and reading guide, plain text; **not for adopters**, see "For the people maintaining this package"), [README.md](./README.md), [README.en.md](./README.en.md), [package.json](./package.json), and [LICENSE](./LICENSE). The directory is self-contained: copy it anywhere on your machine and it works, with no network and no external parts.

The only prerequisite is Node ≥ 18. Usage (`<package path>` is where the package directory lives on your machine):

```bash
node <package path>/bin/init.mjs --dir <target repository path>
```

Without `--dir`, the target is the current working directory — you can also `cd` into the target repository first and then run the package entry point. There are only three arguments:

- `--dir <path>` — target directory.
- `--defaults` — compatibility leftover: init asks no questions, so this equals the default behavior.
- `-h, --help` — help and exit codes.

One run does three things: copy 21 payload files (the `check-docs.mjs` checker and 7 `.gitkeep` placeholders are among the 21), create the three bridging symlinks as needed, and print "next steps". Existing files are never overwritten — anything preserved or occupied is reported in the output, as described in "Adopting into an existing repository".

### What the target repository looks like after install

```text
<target repo>/
├── AGENTS.md               # Curia general rules (8 rules)
├── CLAUDE.md               # -> AGENTS.md (bridge)
├── .agents/
│   ├── README.md           # full spec (the single authority; skeleton text included)
│   ├── GLOSSARY.md         # glossary seeds
│   ├── notes/AGENTS.md     # notes tree entry (read natively by agents)
│   ├── tools/check-docs.mjs
│   ├── plans/ research/ notes/ archive/   # plans / research / notes / archive (each with README and .gitkeep placeholder)
│   └── skills/             # write-doc / write-note / prose-standard
├── .claude/skills          # -> ../.agents/skills (bridge)
├── .codex/skills           # -> ../.agents/skills (bridge)
└── docs/README.md          # root conventions for external facts and knowledge (enable as needed; see the file)
```

That is the entire addition: 21 files plus 3 bridges. If the host already has files with the same names, those are left as they are and are not counted here.

### Alternative: copy directly (without Node ≥ 18)

You can skip the generator and copy the payload verbatim. Always write the source as `template/.` — the trailing `/.` makes `cp` copy dot-directories too; copying the whole directory into an empty repository yields a working workspace (21 files plus 3 bridging links):

```bash
cp -an template/. <target repo>/
```

`cp -R template/*` silently misses the three dot-directories `.agents/`, `.claude/`, and `.codex/` — exit code 0, no error, and you get a tree with no framework. Do not use that form. **`cp -R` (without `-n`) also overwrites same-named files in the host** — including uncommitted changes and untracked files, whose bytes cannot be recovered from git history. **Always copy with `-n`**, and run `git status` first to confirm there is nothing uncommitted.

The downside of a direct copy is that it does not report what it skipped: when the target already has a same-named file, `cp -an` skips it silently (in testing, macOS BSD cp exits with code 1 and prints nothing to stderr), and a bridge may be silently missing. So do not rely on the exit code after a direct copy — count the three bridges as described in "Verify the install". If the target repository already has its own `AGENTS.md`, `CLAUDE.md`, or `.claude/skills`, prefer `init`: it reports which bridge failed to connect, one by one.

A direct copy also only works from a source tree: the payload inside a `npm pack` tarball has no bridging symlinks. If you have a tarball, always use `init` (see "Distribution boundary").

## Verify the install

First, check the exit code and the summary line. In an empty repository the summary line should be:

```text
Done: target <path> — created 21, already identical 0, preserved 0; bridges 3: created 3, already in place 0, not connected 0
```

Exit codes:

| Exit code | Meaning |
|---|---|
| `0` | Payload landed and all three bridges connected |
| `1` | Copy failed — I/O error, a destination resolves outside the target repository (`.agents/`, `docs/`, or similar was pre-made as a symlink pointing outside), or **a destination is inside another git repository** (`.agents/` is a submodule or nested clone) |
| `2` | Usage and guards (bad arguments, target inside the package, Node version too old, etc.) |
| `3` | Bridges not connected — the write completed but the mechanism did not connect |

**The criteria are exit code `0` and "not connected 0"**; the "created / already identical / preserved" numbers vary with the host's shape (in a repository with existing content, "created" will not be 21 and "preserved" will not be 0), so do not compare them literally.

When wiring `init` into CI: if all three bridge paths are free, the exit code is `0` and the pipeline proceeds; if a bridge path in the host is occupied, it returns `3` and the pipeline turns red — clear the obstruction first, per "Adopting into an existing repository". Note that exit code `0` answers "no copy failed and all three bridges connected" — "preserved N items" does not change it; when the host's existing `AGENTS.md` is preserved, the 8 general rules were not installed, as described in the next section.

Second, verify that all three bridges are connected:

```bash
ls -l CLAUDE.md .claude/skills .codex/skills
```

All three must exist and point to `AGENTS.md`, `../.agents/skills`, and `../.agents/skills`, respectively. **Looking at `readlink` is not enough — open it**: `ls .claude/skills` should list the three skill directories `write-doc`, `write-note`, and `prose-standard`. A correct string can still be unopenable — if a parent directory (such as `.claude`) is itself a symlink pointing outside the repository, the link is created outside and resolves to a dangling target. `init` now judges by "**actually resolves, and lands inside the target repository**", so when it says "not connected", it really is not connected; in that shape it also writes nothing outside the repository.

Third, run the self-check (at the target repository root):

```bash
node .agents/tools/check-docs.mjs --strict
```

Exit code `0` means it passes. **The criterion is the exit code, not the document count** — a bare payload tree prints "checked 12 documents / 0 warnings"; put one of your own documents in `docs/` and it becomes 13. The count follows your tree.

Fourth, rerun idempotently: run `init` again against the same target; the exit code should be `0` with "not connected" at `0` (in an empty repository: "created 0, already identical 21, preserved 0; bridges 3: created 0, already in place 3, not connected 0"; in a repository with existing content the numbers vary with what was preserved) — rerunning is safe, and already-identical files are skipped automatically.

## Adopting into an existing repository

`init` never overwrites existing files — good for safety, but it means "exit code `0`" does not equal "everything was installed". Each case is spelled out below.

**The host already has its own `AGENTS.md` (the most common real-world case).** `init` preserves it and lists it under "already exists with different content, not overwritten"; the payload's 8 general rules are not installed — the three bridges still connect, and the exit code may still be `0`. You need to merge the rules yourself: merge all three sections "General rules", "Bridges", and "Structure at a glance" from [template/AGENTS.md](template/AGENTS.md) into your `AGENTS.md` (merge all three together — the project-name placeholder mentioned in "next steps" lives in "Structure at a glance"; merging only "General rules" leaves that pointer pointing at nothing). One check is enough: search your `AGENTS.md` for "one fact, one home" (rule 1) — if it is missing, the rules were not installed. After merging, the "already exists with different content, not overwritten" line **reappears on every rerun**; that is expected, not a sign that the merge did not take effect.

**The host already has `CLAUDE.md` (a real file, not a bridge link).** The bridge cannot be created; `init` warns case by case and names it, and the summary exit code is `3`. To fix: back it up and move it away, merge its content into `AGENTS.md`, and rerun `init` (already-identical files are skipped). The semantics of the bridge are that `CLAUDE.md` becomes a pointer to `AGENTS.md` — a pointer does not hide content.

**The host already has a `.claude/skills` directory (or a link pointing elsewhere).** Also exit code `3`. To fix: move any useful skill content into `.agents/skills/`, back up and move away the occupied path, and rerun `init`. The manual command `init` prints looks like `mv <path> <path>.pre-curia && ln -s <target> <path>`; copy it as is (back up first, then create the link, both in one go). **Do not write a bare `ln -s <target> <path>` yourself**: when the path is already a directory, it creates a same-named sub-link inside the directory with exit code `0`, but the bridge is not connected — a silent false success.

**The host root's `.claude` or `.codex` is itself a symlink pointing outside the repository** (a common shape for shared dotfiles). The relative target `../.agents/skills` then resolves outside the repository through the link and is necessarily dangling; `init` judges "not connected" and explains where the parent resolved, **writing nothing outside the repository**. To connect it, first decide what to do with that symlink (delete it and use a real directory, or expose it another way). This was another silent false success in early versions of this package: the bridge was created outside the repository, `readlink` printed the string exactly right, the exit code was `0`, the self-check was all green — and the bridge was dead and not in the repository at all.

**The host already has `docs/README.md`.** The least disruptive case: it is the root convention for `docs/`, which is enabled as needed and does not affect full use of `.agents/` — merging it or not is not a blocker.

**Where to put backups.** There is no convention: pick a location outside the repository (such as `~/.curia-backup-<date>/`) or an ignored directory inside it. `init` does not manage backups and does not delete anything of yours — the `mv` step is yours to run.

**The host pre-made `.agents/` or `docs/` as a symlink pointing outside the repository.** The payload would be written entirely outside the repository, invisible to git — early versions of this package reported "Done" with exit code `0` here. Now destinations are judged by "walk up to the nearest existing ancestor, then resolve for real"; anything resolving outside the repository is blocked, named item by item, with exit code `1`, and **not a single byte is written outside the repository** (nested shapes such as `.agents/plans/` pointing outside are blocked too). The fix is the same: decide what to do with those symlinks, then rerun.

**The host made `.agents/` a git submodule (or a nested clone).** The payload would be written entirely into **that repository's working tree**, and the host repository's git would never track it (`git add -A` only records the submodule pointer) — while `init` reports "Done". The destination check now extends to git boundaries: a destination inside another git repository is blocked, named item by item, with exit code `1`. To fix: first decide whether `.agents` stays a submodule or becomes a normal directory.

**No Node ≥ 18 and occupied paths.** This combination is the most troublesome: a direct copy does not report conflicts, and `init` needs Node. The way out is manual selection — compare the payload files under `template/` one by one, copy them in, and add the three `ln -s` bridges by hand.

**The host has an existing documentation tree to bring under Curia.** The adoption discipline (six rules: register the roots, do not retro-fit, gate only the default surface, and so on) is in the spec's "Read-only adoption of an existing tree" section (target repo `.agents/README.md`, package copy [template/.agents/README.md](template/.agents/README.md)); this package provides no migration tooling or bulk repair.

After handling any item, finish with the bridge verification and self-check from "Verify the install".

## FAQ

**Is it a runtime or a platform?** No. There is no service, database, network call, permission model, or approval flow; the checker only performs static self-checks.

**Will it overwrite my existing files?** No. Files that already exist with different content are preserved and listed; when a bridge path is occupied, it prints a manual command and skips.

**Can I use it without Node ≥ 18?** Yes. Copy `template/.` directly and add the three bridges by hand, or adopt only the text conventions and skip the checker.

**Must I use all 9 document types?** No. The type table is an upper bound, not a quota; drop types and suggested sections, keeping only what you will actually write.

**Can I upgrade after generating?** There is no `upgrade` subcommand. It is fork-and-own: rerun `init` into a new directory and diff, or cherry-pick with git.

**Can I use it in a monorepo?** Yes. Put the workspace root where you want to manage documents; the default scan covers that root's `.agents/` and `docs/`, and other roots can be inspected with explicit paths.

**Does the checker modify my files?** No. It reports only; there is no `--fix`, and it never writes back.

## For the people maintaining this package

Adopters can stop here; the sections below describe this package's own contract, release process, and acceptance checks.

This repository is the Curia mother repository, developed independently of any adopter. It also contains [`史料/`](./史料/README.md): Curia design history cut from the reference implementation repository, frozen, read-only, and excluded from npm artifacts.

**Why the package is the way it is** — design history, what was tried and failed, and how new mechanisms are judged — is in [`guide/`](./guide/README.md), the **design history and reading guide**: five chapters, plain text, zero scripts. It is **not for adopters**; it is for whoever takes over this package or studies Curia's evolution.

### Hard rules

- **A generator, not a runtime**: `init` only copies the payload, creates bridges, and prints next steps — it asks no questions, installs no hooks, and runs no script from the payload; generated artifacts do not `import` any module from this package.
- **Zero dependencies**: this package's `dependencies` is empty and it uses only Node built-in modules (Node ≥ 18); payload scripts are likewise zero-dependency and make no network calls.
- **Fork-and-own**: after generation, the target repository has no further relationship with this package; there are no resident `upgrade` / `check` subcommands — synchronize by rerunning `init` into a new directory and diffing, or by git cherry-pick.
- **Never overwrite**: files that already exist in the target with different content are preserved and listed; when a bridge is occupied, print the manual "back up and move away, then `ln -s`" command and skip.

### Version discipline

`version` in [package.json](package.json) is artifact identity, not a dependency relationship — **any change to any file in the package** must bump the patch number in the same batch, so that "`create-curia@<version>`" uniquely corresponds to one set of bytes. The criterion is the **artifact**, not the payload: even a README-only change bumps the number, because the tarball bytes change. Earlier, `0.3.0` spanned three different sets of bytes (the payload changed twice after 2.2 landed), so "lossless migration" had no reference for verification; this discipline has been in force since `0.3.1`.

When releasing an artifact, record `shasum -a 512`; an adopter records one line, "adopted `create-curia@<version>`, sha512-…", and thereby has a verifiable identity. Before release, run this check as well (`npm pack` dropping symlinks is expected behavior, not an error):

```bash
npm pack --pack-destination <tmp>
tar -xzf <tmp>/create-curia-<version>.tgz -C <tmp>
diff -rq <tmp>/package/template template    # expected difference: exactly the 3 bridges (CLAUDE.md, .claude/skills, .codex/skills)
```

### Acceptance checks (maintainers)

Each criterion below is runnable; the object under acceptance is the payload itself, not an obligation on adopters. `check-docs` means the payload's `.agents/tools/check-docs.mjs`.

1. **Empty-set assertion**: `mkdir -p /tmp/empty-docs && node .agents/tools/check-docs.mjs --strict /tmp/empty-docs` → prints "no files checked", exit code 2.
2. **Positive case**: in the payload tree (`template/`) or a repository generated from the payload, run `node .agents/tools/check-docs.mjs --strict` from the tree root → exit code 0.
3. **Root-anchor assertion**: run the default invocation in a directory that does not itself contain `.agents/` (for example `cd /tmp && node <path>/check-docs.mjs`) → prints "root anchor missing", exit code 2; it does not silently degrade and does not walk up to parent directories.
4. **Zero dependencies**: `rg -n "from ['\"]|require\(|import\(" template/.agents/tools/check-docs.mjs` → only `node:`-prefixed built-in module names should appear.
5. **Portability**: copy `.agents/` into a temporary directory with no git and no `node_modules`, then run `node .agents/tools/check-docs.mjs --strict` → the same verdict as in the source directory.
6. **Bridge assertions**: `init` into an empty host → exit code 0, summary line "bridges 3: created 3, already in place 0, not connected 0"; rerun against the same empty host → "created 0, already identical 21, preserved 0; bridges 3: created 0, already in place 3, not connected 0", exit code 0; `init` into a host that already has a real `CLAUDE.md` file → exit code 3, naming the bridges that failed to connect (rerunning against that host still returns 3 — it does not fix itself until the occupied paths are cleared).
7. **Exit-code assertions**: `node bin/init.mjs --bogus` → exit code 2; `node bin/init.mjs --dir <path inside the package>` → exit code 2; `node bin/init.mjs --help` → exit code 0.
8. **Version-discipline spot check** (before release, manual): `git log -1 --stat` shows changes in this repository (`template/`, `bin/`, or `README.md`) while `package.json`'s `version` did not bump in the same batch → artifact identity has decoupled from the bytes; do not release.
9. **Bridge-resolution assertion**: `init` into a host where `.claude` is a symlink pointing outside the target repository → exit code 3, naming "parent directory … resolves outside the target repository", and **zero writes to that outside directory** (the `ls -A` count is unchanged before and after).
10. **Structure-group false-green assertion**: build a tree containing only `.agents/README.md` and `.agents/tools/check-docs.mjs`, with none of the five homes (`plans/ research/ notes/ skills/ archive/`), then run the default invocation → the summary line carries "structure group has no objects to judge" (an annotation; the exit code still follows the warning count).
11. **Out-of-surface typed-document assertion**: put a document with a `Type: plan` three-line header into `docs/`, and the same content into `.agents/plans/` → group 2 reports only the one in `docs/` ("a document of type `plan` lives outside `.agents/`"), and `--strict` exits with code 1.
12. **Destination assertion**: the host pre-makes `.agents/` (or `docs/`, or a nested `.agents/plans/`) a symlink pointing outside the repository → `init` exits with code `1`, naming item by item "destination … resolves outside the target repository", and **zero writes to that outside directory** (the `ls -A` count is unchanged before and after).
13. **Git-boundary assertion**: the host makes `.agents` a git submodule → `init` exits with code `1`, naming item by item "inside another git repository", and **zero writes to the submodule's working tree**.

### Distribution boundary

This package is **not distributed through a public registry**. Distribution has three channels: the source entry point, direct payload copying, and release artifacts (tarballs, see "Version discipline"). Release artifacts are published in this repository as `curia-v<version>` tags with tarball assets (the first artifact was `curia-v0.3.1`; `curia-v0.3.1` through `curia-v0.3.10` were moved into this repository during the split). The `private: true` in [package.json](package.json) is a standing safeguard against accidental publication, not a transitional marker to be removed — do not remove it.

`npm pack` silently drops the payload's 3 bridging symlinks (3 in the source payload → 0 in the tarball, zero warnings) — tarball adopters must always use `init` (bridge creation is performed by the bridge step and does not depend on the links in the payload), or add the three `ln -s` bridges by hand; a direct copy from a tarball yields a workspace with zero bridges.

The package name `create-curia` is unclaimed on the public registry, while machines point at the public source by default — if it were squatted, `npm create curia` would silently fetch and execute third-party code on machines with default configuration. This package therefore does not promote the `npm create curia` usage (which is unavailable anyway while the package is not published). The placeholder value of the `repository` field does not affect usage.

## License

MIT, see [LICENSE](./LICENSE).
