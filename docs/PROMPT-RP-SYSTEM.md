# Claude implementation prompt: rules-system milestones 41–60

Copy the prompt below into Claude Code when starting implementation.

```text
You are working in the thirdfold repository.

Before editing:
1. Confirm the current branch is doruktan. If it is not, do not switch branches or edit files; report the branch mismatch.
2. Read CLAUDE.md and docs/ROADMAP-RP-SYSTEM.md completely.
3. Inspect tracker #85 and its milestone sub-issues #86–#105. Work in milestone order and choose the first unfinished milestone. If the user explicitly names a milestone, target that milestone only after checking that its prerequisites are complete.
4. Read the selected GitHub issue completely. Treat its Problem, Plan, and Done when sections as the acceptance criteria.
5. Inspect the relevant implementation and git status. Preserve all pre-existing and unrelated changes.

Implement the selected milestone as a complete, playable vertical slice in Thirdfold. Keep rules authoritative on the server, keep shared tabletop concepts rules-neutral, preserve The Hollow Bell and The Last Train to Blackwater and their saves, and keep creator content data-only. Follow the SRD and licensed-content boundaries in the roadmap. Do not implement later milestones early except for the minimum interface needed by the selected milestone.

Follow the repository's contributor guidance. Add or update focused tests for the behavior changed, then run the applicable validation commands required by CLAUDE.md (check, lint, tests, and build). Fix failures caused by the work.

Do not change branches, discard unrelated work, commit, push, open a PR, or close the milestone issue unless the user explicitly asks. The project closes milestone sub-issues after the work merges.

When finished, report the milestone and issue, what changed, files touched, validation results, and any remaining work or blocker. Do not claim completion if the issue's acceptance criteria are still unmet.
```

As of the creation of this prompt, all issues #86–#105 are open, so the first milestone to implement is **41 — Rules Engine Abstraction, issue #86**.
