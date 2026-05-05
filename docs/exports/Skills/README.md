# huckwnmo99 Codex Skills

Personal reusable Codex skills.

This repository is meant to keep useful `SKILL.md` workflows in one place so they can be installed into any Codex workspace later.

## Structure

```text
Skills/
  README.md
  skills/
    karpathy-guidelines/
      SKILL.md
    qa/
      SKILL.md
    diagnose/
      SKILL.md
    ...
```

Each skill lives in `skills/<skill-name>/SKILL.md`.

## Install Into Codex Globally

Use this when you want the skills available in every Codex workspace on the same machine.

```powershell
git clone https://github.com/huckwnmo99/Skills.git
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force .\Skills\skills\* "$env:USERPROFILE\.codex\skills\"
```

Restart Codex after copying.

## Install Into One Project

Use this when you want the skills available only inside one repository.

```powershell
git clone https://github.com/huckwnmo99/Skills.git
cd C:\path\to\your\project
New-Item -ItemType Directory -Force -Path .\.agents\skills
Copy-Item -Recurse -Force C:\path\to\Skills\skills\* .\.agents\skills\
```

Restart Codex after copying.

## Install One Skill

```powershell
git clone https://github.com/huckwnmo99/Skills.git
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force .\Skills\skills\karpathy-guidelines "$env:USERPROFILE\.codex\skills\"
```

## Install From GitHub In Codex

You can also ask Codex to install a specific skill from this repo:

```text
Install the Codex skill from https://github.com/huckwnmo99/Skills/tree/main/skills/karpathy-guidelines
```

Or by repo and path:

```text
Install skill huckwnmo99/Skills path skills/karpathy-guidelines
```

## Included Skills

- `caveman`
- `design-an-interface`
- `develop`
- `diagnose`
- `edit-article`
- `fix`
- `git-guardrails-claude-code`
- `grill-me`
- `grill-with-docs`
- `improve-codebase-architecture`
- `karpathy-guidelines`
- `migrate-to-shoehorn`
- `obsidian-vault`
- `plan`
- `qa`
- `request-refactor-plan`
- `review`
- `scaffold-exercises`
- `setup-matt-pocock-skills`
- `setup-pre-commit`
- `skill-creator`
- `tdd`
- `test`
- `to-issues`
- `to-prd`
- `triage`
- `ubiquitous-language`
- `write-a-skill`
- `zoom-out`

## Maintenance Notes

- Keep one skill per folder.
- Every skill folder must contain a `SKILL.md`.
- Do not commit secrets, tokens, private keys, or machine-specific credentials.
- If a skill depends on local scripts or references, keep those files inside the same skill folder.
