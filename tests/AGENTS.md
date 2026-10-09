# Tests

- Protect externally observable safety, connection boundaries, stale input handling and workflow behavior using Vitest.
- Keep mocks and helpers under tests. Native Obsidian validation must be distinguished from mock API validation.
- Do not duplicate trivial DOM implementation tests. Use a short manual checklist for editing and sidebar appearance.
- Keep raw evidence under `.local/`; stable docs describe reproducible checks rather than a run's results.
