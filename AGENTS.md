# EngramWeave Obsidian

- Follow system semantics in `../engramweave-docs/CONTEXT.md` and the current execution scope. The MVP direct publication exception is documented there.
- Keep native Markdown editing in Obsidian. Core owns model execution, stage transitions, protected publication and recovery.
- Use English code, comments and identifiers. Write Chinese maintained documentation except AGENTS, CONTEXT and ADRs, which use English.
- Keep local evidence, checkpoints and scratch files under gitignored `.local/`.
- Use the official Obsidian API and mature build tools. No separate rendering framework or custom test harness.
- Put meaningful contract, safety and persistence tests under `tests/`; follow `tests/AGENTS.md`.
- Do not store Core bearer tokens or model credentials in Vault plugin settings. Only local configuration paths may be persisted.
