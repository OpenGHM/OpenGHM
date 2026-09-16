# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Use GitHub's private vulnerability reporting instead: open this repository's
**Security** tab and select **Report a vulnerability**. That creates a private
advisory visible only to the maintainers and you, so a fix can be prepared
before the details are public.

If that tab is not available (private reporting has to be enabled by a
repository owner), open a regular issue asking a maintainer to enable it,
without describing the vulnerability there.

## What is in scope

This repository is the OpenGHM product: the gateway (`web-gateway/`), the
`openghm` toolkit (`packages/openghm/`), the container image recipes
(`images/`), and the snapshot spec (`schemas/`).

How our own instance is deployed — cluster configuration, credentials, the
Anvil environment — lives in a separate private repository and is not
reachable through this one; see
[ADR 0016](docs/decisions/0016-split-public-and-ops-repositories.md). A report
about our specific deployment (rather than the software) is still welcome
through the same channel — a maintainer will route it appropriately.

## What to expect

Every report gets an acknowledgement. There is no fixed SLA yet — this is a
research-software project without a dedicated security team — but a
vulnerability that affects a real deployment is treated as the priority it is.
