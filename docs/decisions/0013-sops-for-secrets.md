# ADR 0013 — Kubernetes secrets are SOPS-encrypted in the repository, keyed by SSH keys

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-08 |
| **Affects** | `deploy/secrets/`, the `justfile`'s apply path, anyone who deploys |

## Context

`deploy/k8s/<env>/secrets.yml` was gitignored and hand-edited from a committed
template. That put every secret value on exactly one laptop, with no history,
no review, and no second copy but the cluster itself.

It had already failed. The dev file was generated from an older template and
never gained four keys that `backend.yml` and `frontend.yml` require with
`optional: false`. The next `kubectl apply` would have failed both pods with
`CreateContainerConfigError`, and no diff anyone reads would have shown it,
because the file is in no diff at all.

## Decision

**Secrets are encrypted with [SOPS](https://getsops.io) and committed**, at
`deploy/secrets/<env>.enc.yml`.

**Only the values are encrypted** — `encrypted_regex: ^(data|stringData)$`, so
`apiVersion`, `kind` and `metadata` stay readable. That is the point rather
than a detail: a diff shows *that* `RESEND_API_KEY` was added, and which
namespace a Secret targets, without showing any secret. Encrypting the whole
document would hide the half worth reviewing.

**Recipients are the deployers' existing SSH public keys.** SOPS accepts
`ssh-ed25519` and `ssh-rsa` public keys as age recipients, and finds the
private key at `$SOPS_AGE_SSH_PRIVATE_KEY_FILE`, then `~/.ssh/id_ed25519`,
then `~/.ssh/id_rsa`. Nobody holds a second secret, and no new key needs
backing up.

**The encrypted file lives outside `deploy/k8s/<env>/`.** `kubectl apply -f
<dir>` globs every `*.yml` in the directory, so an encrypted Secret sitting
beside the manifests is applied verbatim — `SECRET_KEY` becomes the literal
string `ENC[AES256_GCM,...]` and every pod fails. Verified with
`--dry-run=client` before the split. `deploy/secrets/` is the fix, and it is
structural: no ordering or flag can reintroduce the problem.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Sealed Secrets | Needs a controller running in the cluster. The rules say what we deploy is stateless, and this would be the only standing component that exists to serve our own tooling. |
| External Secrets Operator | Points at a secret store — Vault, AWS Secrets Manager. We run none, and standing one up for nine keys is not proportionate. |
| A dedicated age key per deployer | One more secret to generate, distribute and back up, for no gain over a key everyone already has and already protects. |
| Keep the gitignored plaintext | Free, and works for exactly one person. No history, no review, no second copy, and the failure above repeats. |

## Consequences

**A deployer's SSH key cannot have a passphrase.** SOPS reads the private key
file directly and ssh-agent cannot help — it never releases the key. Anyone
whose key is protected needs an unprotected one, or their own age key added
alongside. This is a real constraint on who can be added.

**Auth and decryption now share a key's lifetime.** Rotating an SSH key means
`sops updatekeys` on every encrypted file, or that person loses access. One
command, but it has to happen.

**A key whose private half has leaked must not be a recipient.** Adding one
converts a leaked auth credential into a leaked *secrets* credential —
`openghm_anvil_ed25519` is exactly this case, and is deliberately not
registered.

**Losing every private key is recoverable, not fatal.** The cluster holds the
values: `kubectl get secret openghm-secrets -o yaml`.

`just k8s-apply` is now two commands, and the Secret goes first — it has to
land before the Deployments that reference its keys. Nothing decrypts to disk;
`sops decrypt … | kubectl apply -f -` keeps plaintext in a pipe.
