# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security reports.** Please email the
maintainers directly (darshan.kachare.dev@gmail.com) or open a private
vulnerability report via GitHub's "Report a vulnerability" (Security tab).

We will:

- acknowledge within 72 hours,
- evaluate the report and coordinate a fix,
- keep you informed during disclosure.

Please include: affected version(s), a minimal reproduction, and impact if
known. Responsible disclosure is appreciated — please give us time to fix
before posting details publicly.

## Security model

MCP Nexus **executes tools on behalf of connected agents**. This is the most
sensitive surface in the project. Treat the following as first-class:

- **Unstrusted tools are dangerous.** Review a tool's manifest permissions and
  the global policy rules before enabling it.
- **Default is allow** in V1. Configure `.nexus/policy.json` rules for anything
  you do not fully trust. This is documented prominently in the README.
- **Execution isolation** is subprocess-level with a timeout. It is *not* a
  container sandbox; do not run untrusted tools in a privileged context.
- **Secrets.** Never commit `.env`, API keys, tokens, or private certificates.
  Use `.env.example` and the `NEXUS_HOME` runtime directory (gitignored).

## Supported versions

| Version | Supported |
| --- | --- |
| main | ✔ |
| 0.1.x | security fixes only until 0.2.0 ships |

## Reporting expectations

Type | Response
--- | ---
Severe (RCE, privilege escalation, data exposure) | fix within 7 days, coordinated disclosure
Moderate (policy bypass, sandbox escape under threat model) | fix within 30 days
Low (logging, hardening, dependency bumps) | normal issue workflow