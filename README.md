# Smart-Codebase

[English](README.md) | [简体中文](README.zh-cn.md)

> **Turn your OpenCode into a senior project expert that learns and grows with every task.**

---

## 🔥 The Pain Point

Every time you start a new session, AI starts from scratch. It doesn't remember:
- Why you chose that architecture?
- What gotchas exist in your codebase?
- What patterns your team follows?
- What you learned from debugging that nasty bug?

**You explain the same things over and over.**

## ✨ The Solution

smart-codebase automatically captures knowledge from your sessions and makes it available to future sessions.

```mermaid
graph TB
    Start([Session Work])
    Extractor[AI Extractor Analyzes]
    SkillFile[.knowledge/SKILL.md<br/>Per Module]
    ProjectSkill[.opencode/skills/project/SKILL.md<br/>OpenCode Auto-Discovery]
    NewSession([New Session Starts])
    Injector[Knowledge Injector]
    
    Start -->|idle| Extractor
    Extractor -->|write| SkillFile
    Extractor -->|update index| ProjectSkill
    
    NewSession --> Injector
    Injector -->|inject hint| ProjectSkill
    ProjectSkill -.->|references| SkillFile
```

---

## 📖 Table of Contents

- [⚙️ How It Works](#️-how-it-works)
- [📦 Installation](#-installation)
- [⚡ Commands](#-commands)
- [⚙️ Configuration](#️-configuration)
- [📁 File Structure](#-file-structure)
- [🛠️ Development](#️-development)

---

## ⚙️ How It Works

1. **You work normally** - Edit files, debug issues, make decisions
2. **Session goes idle** - After 15 seconds of inactivity
3. **Extractor analyzes** - Examines what changed and why
4. **Knowledge captured** - Stored in `<module>/.knowledge/SKILL.md`
5. **Index updated** - Global index at `.opencode/skills/<project>/SKILL.md`
6. **Next session starts** - AI reads the project skill, then relevant module skills

**The plugin accumulates knowledge for you. Just focus on coding.**

---

## 📦 Installation

Navigate to `~/.config/opencode` directory:

```bash
# Using bun
bun add smart-codebase

# Or using npm
npm install smart-codebase
```

Add to your `opencode.json`:

```json
{
  "plugin": ["smart-codebase"]
}
```

---

## ⚡ Commands

| Command | Description |
|---------|-------------|
| `/sc-status` | Show knowledge base status |
| `/sc-extract` | Manually trigger knowledge extraction |
| `/sc-rebuild-index` | Rebuild `.knowledge/KNOWLEDGE.md` from all SKILL.md files |

---

## ⚙️ Configuration

No configuration required by default. To customize, create `~/.config/opencode/smart-codebase.json` (or `.jsonc`):

```jsonc
{
  "enabled": true,
  "debounceMs": 30000,
  "autoExtract": true,
  "autoInject": true,
  "extractionModel": "minimax/MiniMax-M2.1",
  "disabledCommands": ["sc-rebuild-index"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable the plugin entirely |
| `debounceMs` | `15000` | Wait time (ms) after session idle before extraction |
| `autoExtract` | `true` | Automatically extract knowledge on idle |
| `autoInject` | `true` | Inject knowledge hint at session start |
| `extractionModel` | - | Model for extraction, format: `providerID/modelID` |
| `extractionMaxTokens` | `8000` | Max token budget for extraction context |
| `disabledCommands` | `[]` | Commands to disable, e.g. `["sc-rebuild-index"]` |

---

## 📁 File Structure Example

```
project/
├── .opencode/
│   └── skills/
│       └── <project-name>/
│           └── SKILL.md          # Project skill
│
├── src/
│   ├── auth/
│   │   ├── .knowledge/
│   │   │   └── SKILL.md          # Auth module knowledge
│   │   ├── session.ts
│   │   └── jwt.ts
│   │
│   └── payments/
│       ├── .knowledge/
│       │   └── SKILL.md          # Payments module knowledge
│       └── stripe.ts
```

The project skill at `.opencode/skills/<project>/SKILL.md` serves as the global index and is auto-discovered by OpenCode. Module-level knowledge is stored in `.knowledge/SKILL.md` within each module directory.

---

## 🛠️ Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run typecheck
```

---

## 📄 License

[Apache-2.0](LICENSE)
