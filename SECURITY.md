# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** This repository is public, and an issue
describing a working attack is a disclosure before there is a fix.

Use GitHub's private vulnerability reporting instead:

**[Security tab](../../security) → Report a vulnerability**

That opens a private thread visible only to the maintainers. If the tab is not
available to you, mail the maintainers via the address on the GitHub profile
that owns this repository.

## What to include

Enough to reproduce it. In practice:

- What an attacker gains — data, money, someone else's account
- The steps, in order, and the device / OS / app version they were run on
- Anything that limits it: does it need a jailbroken device, a machine-in-the-middle,
  physical access, a specific account?

A proof of concept is welcome. Please do not test against other people's accounts,
and please do not run anything that costs us GPU time at scale — a single request
that demonstrates the point is enough.

## Scope

In scope:

- This repository — the Expo / React Native client, the Supabase schema under
  `supabase/`, and the Edge Function under `supabase/functions/`
- Our Supabase project, as reachable from a released build
- The backend rendering service, which lives in a separate private repository.
  Report it here; we will route it.

Out of scope:

- Third-party services themselves (Supabase, RevenueCat, Apple). Report those to
  their own programmes. What *is* in scope is our misuse of them.
- Anything requiring a jailbroken device **and** physical access, unless it
  reaches another user's data or money
- Denial of service by volume alone
- Missing hardening that has no path to impact — certificate pinning,
  anti-tampering, obfuscation. We know. See "Known and accepted" below.

## Known and accepted

Please do not report these; they are deliberate.

- **`EXPO_PUBLIC_SUPABASE_ANON_KEY` is readable in the app bundle.** That key is
  public by design. It is only ever a ticket to the PostgREST endpoint, and every
  table it can reach is behind row-level security. Finding it in the bundle is not
  a finding. Finding a *table or function it can reach that it should not* very
  much is.
- Any `EXPO_PUBLIC_*` value is readable in the bundle — that is what the prefix
  means in Expo.

## What happens next

We are a two-person team building to a deadline, so this is best effort rather
than a service level agreement:

| | |
|---|---|
| We acknowledge | within 5 days |
| We tell you what we think | within 14 days |
| Fix, or a date for one | depends on severity; we will say which |

We will credit you when we publish a fix, unless you would rather we did not.
We do not run a paid bounty.

## Handling

Reports are discussed in the private advisory thread and nowhere else until a fix
ships. If a report turns out to affect users, we will publish a GitHub Security
Advisory from this repository once the fixed build is available.
