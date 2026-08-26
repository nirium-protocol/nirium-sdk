# Contributing to nirium-sdk

Thank you for your interest in contributing. This repository holds the open-source developer toolkit: the TypeScript SDK, the Python SDK, the CLI, the MCP server, examples, and docs. It does not contain the agent runtime or the Soroban contracts, which are maintained privately.

> **Note:** Nirium operates under the [Stellar Code of Conduct](https://github.com/Eras256/Nirium/blob/main/CODE_OF_CONDUCT.md). Violations can be reported to [niriumprotocol@gmail.com](mailto:niriumprotocol@gmail.com) or [community@stellar.org](mailto:community@stellar.org).

---

## Development Setup

### Prerequisites

- Node.js 20+
- Python 3.10+ (for `packages/sdk-python`)
- Git

### Getting Started

```bash
git clone https://github.com/nirium-protocol/nirium-sdk.git
cd nirium-sdk

# TypeScript SDK / CLI / MCP server each have their own package.json
cd packages/sdk && npm install && npm run build

# Python SDK
cd packages/sdk-python && pip install -e .
```

### Package Scripts (TypeScript packages)

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run dev` | Watch mode |
| `npm run lint` | ESLint |
| `npm run test` | Jest |

---

## Repository Structure

```
nirium-sdk/
├── packages/sdk/           → TypeScript SDK (npm: nirium)
├── packages/sdk-python/    → Python SDK (pip: nirium)
├── packages/mcp/           → MCP server (npm: nirium-mcp)
├── packages/cli/           → CLI (npm: nirium-cli)
├── docs/                   → Quickstarts and guides
└── examples/               → Runnable integrations (Express, Next.js, treasury vault)
```

---

## Contribution Guidelines

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests and lint for the package(s) you touched
5. Commit using conventional commits (see below)
6. Push and open a PR against `main`

Reviewers will not follow up for missing context — include a clear description of what changed and why.

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, tooling, CI |

### AI Assistance Disclosure

Every commit produced with AI assistance carries a `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. This is a factual disclosure of how the commit was produced — it is never stripped to make a commit look human-authored, and never added where it doesn't apply to fake the opposite. If you use AI assistance in your own contributions, disclose it the same way.

### Code Style

- **TypeScript:** strict mode, explicit types for all public APIs
- **Python:** type hints on public functions
- **Comments:** only when the *why* is non-obvious — no narration of what the code does

---

## Security

If you discover a security vulnerability, **do not open a public issue.**

Email: **niriumprotocol@gmail.com**

Include: description, reproduction steps, potential impact, and any suggested remediation.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).

---

*Updated August 13, 2026*
