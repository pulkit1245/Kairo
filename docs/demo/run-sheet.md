# Kairo demo run sheet

What to start, in what order, what to check, and what to do when something gets in the way. The demo steps themselves are added after the rehearsal.

## Public links

Each app's public link is a Cloudflare quick tunnel, and it gets a new address every time the backend restarts. On demo day, open an app's public link from the dashboard (the Apps list or the app's header) once everything has started. Never use a copy saved earlier, from a note, a chat or a previous run: it points at a tunnel that no longer exists.

## If something blocks Kairo

**Kairo's Kubernetes writes are refused** (a log line or an onboarding failure saying "kairo-platform may only change kairo-&lt;app&gt; namespaces …"): the admission policy that limits Kairo's own account is in the way. Switch it off at once:

```bash
kubectl --context docker-desktop delete validatingadmissionpolicybinding kairo-platform-writes
```

Kairo works as before (without the limit) until `terraform apply` in `infra/terraform` puts it back. To see what the account may and may not write: `infra/scripts/check-platform-writes.sh`.
