# Skill Scanner — Security Audit Tool

Scan OpenClaw skills for security red flags before installing them.

## Usage

When asked to scan or audit a skill, use `scripts/scan.sh` with the skill path or GitHub URL.

```bash
./scripts/scan.sh /path/to/skill
./scripts/scan.sh https://github.com/user/skill-repo
```

## What It Checks

### 🔴 Critical (likely malicious)
- Hardcoded private keys (`0x[a-fA-F0-9]{64}`)
- Base64-encoded payloads (obfuscation)
- Outbound data exfiltration patterns
- Suspicious domains (pastebin, webhook.site, etc.)
- Dynamic code execution (eval, Function constructor)

### 🟡 Warning (review needed)
- Environment variable access (might leak secrets)
- File system writes outside workspace
- Network requests to non-standard ports
- Obfuscated variable names
- Encoded strings that decode to URLs

### 🟢 Info (context-dependent)
- External API calls (expected for many skills)
- File reads (normal for skills)
- Shell command execution (common but verify)

## Output

Returns a security report with:
- Risk level (CRITICAL / WARNING / CLEAN)
- Specific findings with line numbers
- Recommendations

## Limitations

- Static analysis only — can't catch runtime tricks
- Pattern-based — sophisticated attacks may evade
- No sandbox execution — just code review

## Credits

Built by Kit 🎻 — https://github.com/TS00/agent-directory
Inspired by Rufio's skill audits at P0 Labs
