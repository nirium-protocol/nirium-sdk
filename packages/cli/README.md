# @nirium/cli

Scaffolding CLI for the **Nirium Protocol** SDKs — generates a starter project wired to a live Nirium agent in one command.

## Install

```bash
npm install -g @nirium/cli
```

## Usage

```bash
nirium create bot --name my-bot --template ts
```

| Option | Values | Default |
|---|---|---|
| `-n, --name <name>` | project directory name | `nirium-bot-v1` |
| `-t, --template <template>` | `ts` or `py` | `ts` |

This scaffolds a minimal project that connects to a Nirium agent and prints incoming real-time signals — a working starting point built on the [`nirium`](https://www.npmjs.com/package/nirium) (npm) or [`nirium`](https://pypi.org/project/nirium/) (PyPI) SDK.

```bash
cd my-bot
npm install && npm run dev       # TypeScript
# or
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && python main.py   # Python
```

Set `NIRIUM_API_URL` and `NIRIUM_API_KEY` in the generated `.env` before running against a live agent (`https://nirium-agent.fly.dev` for testnet).

## Current scope

Only `nirium create bot` is implemented today (`skill` and `kernel` scaffolds are reserved for a future release and currently exit with an error).

## Links

- [Documentation](https://nirium.xyz/docs)
- [TypeScript SDK](https://www.npmjs.com/package/nirium)
- [Python SDK](https://pypi.org/project/nirium/)
- [GitHub](https://github.com/nirium-protocol/nirium-sdk)

## License

Apache 2.0 — Nirium Protocol
