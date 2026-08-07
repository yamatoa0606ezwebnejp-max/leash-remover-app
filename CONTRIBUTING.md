# Contributing

This repo is public. A few ground rules keep it usable without turning into overhead for a two-person team.

## Language

Single rule: **anything a reviewer might see is in English. Everything else can be Japanese.**

| Item | Language | Why |
|---|---|---|
| README | English | First thing anyone sees; doubles as the Devpost draft |
| Commit messages | English | The commit log reads as the project history |
| Issue / PR titles | English | Visible in list views |
| Issue / PR body | Japanese is fine | Content isn't reviewer-facing; prioritize discussion quality |
| Code comments | English | Read alongside the code |

## Commit messages

Format: `type: summary`

Five types only:

```
feat: add leash detection endpoint
fix: prevent credit consumption on detection failure
docs: update README with print export section
chore: bump expo sdk
refactor: split export logic from view
```

Enough detail that scanning the log tells you what happened. Nothing more elaborate.

## Branching

`main` only. Branch strategy for a two-person team becomes its own maintenance burden. Cut a short-lived branch only for something you don't want to break `main` with, and merge it quickly.

## What we're intentionally not doing

- Issue / PR templates — overhead for two people
- Mandatory review — blocks on the other person's availability
- Heavy CI — a broken pipeline in September is worse than no pipeline; add it once things are stable

## Security / privacy

- Never commit `.env`, API keys, certificates, or `.p12` files
- Never commit test photos — a photo with someone else's dog in it is a rights issue
