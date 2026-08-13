# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| 0.x | ❌ |

Fixes land on the latest 1.x release. There are no backports to 0.x, and no
maintenance branches for older lines. If a fix has to be a breaking change it
will still ship, with the break described in the release notes.

## Reporting a vulnerability

Please report security issues privately, not as a public issue, a SourceHut
ticket or a GitHub discussion:

- [Open a private security advisory][advisory] on GitHub — preferred, as it
  keeps the report and the fix in one place.
- Or email <hi@ayo.run>.

You can expect an acknowledgement within five working days. If a report is
valid, you will get an estimated fix date and credit in the advisory unless you
would rather stay anonymous.

[advisory]: https://github.com/ayo-run/astro-sw/security/advisories/new

## Scope

This package runs at **build time**, inside your Astro build, and what it emits
is a service worker that runs in your visitors' browsers. A report is
security-relevant if it crosses a trust boundary in one of those two places.

**In scope:**

- The integration emitting a `sw.js`, or a page-level registration script, that
  does something the project's own configuration and service worker source did
  not ask for.
- The injected `__assets`, `__version` or `__prefix` values escaping the
  declarations they are written into and becoming code.
- Anything a build *dependency* controls — rather than the project's own files —
  changing what ends up in the bundled service worker.

**Out of scope:**

- **Anything that needs control of `astro.config.mjs`, of the service worker
  source `path` points at, or of the build machine.** All three are already
  build input and run with the build's privileges.
- **`registrationHooks` callbacks are stringified and inlined into every page.**
  That is the documented design — it is why the hooks have to be self-contained
  — not a boundary being crossed.
- **A site caching its own responses in a way its authors did not intend**, where
  the caching logic lives in the project's own service worker.
