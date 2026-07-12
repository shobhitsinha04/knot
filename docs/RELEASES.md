# Release History

Version history for **Knot AI** (`freshgoldfish.knot-ai`) on the VS Code Marketplace.

Marketplace listing: https://marketplace.visualstudio.com/items?itemName=freshgoldfish.knot-ai

| Version | Date | PR | Summary |
|---------|------|----|---------|
| [v0.1.4](#v014) | 2026-07-11 | #18 | Stylistic changes to README + marketplace description |
| [v0.1.3](#v013) | 2026-07-11 | #17 | Listing polish: README banner, intro copy, release docs |
| [v0.1.2](#v012) | 2026-07-11 | #16 | Critical fix: bundle runtime deps so the extension activates |
| [v0.1.1](#v011) | 2026-07-11 | #15 | Initial launch on the VS Code Marketplace |

---

## v0.1.4

**Stylistic changes** to the README and the marketplace description. Copy-only; no functional code changes.

## v0.1.3

Marketplace listing polish:

- New README banner and refreshed intro copy.
- Added the long-form logo asset (`media/knot-logo-long.jpg`).
- Added the internal release runbook (`docs/RELEASING.md`).

## v0.1.2

Critical activation fix. The initial published `.vsix` shipped without its LanceDB / Apache Arrow runtime dependencies, so the extension failed to activate on install. Fixed by bundling `apache-arrow`, `flatbuffers`, and `tslib` (via `.vscodeignore`).

## v0.1.1

Initial public release. First publish of Knot AI to the VS Code Marketplace at the end of Phase 8.
