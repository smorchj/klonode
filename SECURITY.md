# Security Policy

## Supported versions

Klonode is in early alpha (v0.1.x). Security fixes land on the `main` branch and are included in the next release. We do not yet backport fixes to older releases.

## Threat model

Klonode reads source files, extracts text from them (comments, docstrings, filenames, exports, schemas), and inlines that text into `CONTEXT.md` files. Those files are later passed to Claude (or another AI assistant) as system context.

This creates a **direct prompt injection surface**. An attacker who controls any source file in a repo Klonode scans can embed instructions that will be fed to the model as if they came from the user.

### What Klonode protects against

- **Known injection patterns** in extracted comments and docstrings (`IGNORE PREVIOUS INSTRUCTIONS`, role-override phrases, system prompt spoofing, jailbreak phrases) — see `packages/core/src/security/sanitize.ts`
- **Zero-width character smuggling** in extracted text
- **Markdown structure breakers** (triple backticks, forged headers) in extracted text
- **Aggressive truncation** of untrusted extracted content (80 char default)

### What Klonode does NOT protect against

- **You running Klonode on an untrusted repo and then chatting with Claude.** If you clone random code from the internet, run `klonode init`, and send queries to Claude via the Workstation UI, you are trusting both the repo authors and Claude's ability to resist injection.
- **Novel injection patterns** not yet in our detector.
- **Malicious CONTEXT.md files** that were hand-edited with `<!-- klonode:manual -->` to bypass regeneration. These are treated as trusted by default — see [#49](https://github.com/smorchj/klonode/issues/49) for planned mitigation.
- **Claude's own vulnerabilities.** Klonode does not defend against weaknesses in the underlying LLM.
- **Anything run by the Claude CLI** itself when you grant it write/exec tools.

## Recommended safe usage

1. **Only run Klonode on repos you trust** — code from your own team, well-known open source projects, etc.
2. **Review manually-edited `CONTEXT.md` files** before running the Workstation UI against a repo.
3. **Run the Claude CLI with minimal tool permissions** during first use on a new repo. Start with read-only tools.
4. **Inspect generated `CONTEXT.md` files** before committing them — Klonode flags injection attempts but cannot catch everything.
5. **Use sandboxed environments** (containers, VMs) for repos you don't fully trust.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's [private vulnerability reporting](https://github.com/smorchj/klonode/security/advisories/new) to file a report. We will acknowledge within 7 days and aim to ship a fix within 30 days for high-severity issues.

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (optional)

## Disclosure

We follow coordinated disclosure. Once a fix is released, we will credit the reporter (if desired) in the release notes and `CHANGELOG.md`.

## References

- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- Simon Willison's [prompt injection writing](https://simonwillison.net/series/prompt-injection/)
- [Tracking issue #45](https://github.com/smorchj/klonode/issues/45) for ongoing hardening work
