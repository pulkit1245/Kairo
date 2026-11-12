# Kairo demo run sheet

What to start, in what order, what to check, and what to do when something gets in the way. The demo steps themselves are added after the rehearsal.

## If something blocks Kairo

**Kairo's Kubernetes writes are refused** (a log line or an onboarding failure saying "kairo-platform may only change kairo-&lt;app&gt; namespaces …"): the admission policy that limits Kairo's own account is in the way. Switch it off at once:

```bash
kubectl --context docker-desktop delete validatingadmissionpolicybinding kairo-platform-writes
```

Kairo works as before (without the limit) until `terraform apply` in `infra/terraform` puts it back. To see what the account may and may not write: `infra/scripts/check-platform-writes.sh`.
