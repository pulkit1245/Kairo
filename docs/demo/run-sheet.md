# Kairo demo run sheet

What to start, in what order, what to check, the demo itself step by step, and what to do when something gets in the way. The times come from the measured runs (note 06, P5f), so you can tell at a glance whether a step is late.

## The day before

- **Disk.** Docker Desktop keeps its disk on the external SSD **DockerDisk**. It must be plugged in and mounted (`ls /Volumes/DockerDisk`) before Docker Desktop starts, and stay plugged in. If it drops, everything stops (see "If something goes wrong"). The Mac's own disk should have a few GB free (`df -h /`).
- **Power and sleep.** Charger in. Turn off sleep on power (System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when the display is off"), or run `caffeinate -dims` in a terminal tab for the whole demo.
- **Gemini.** The key is on the free tier, about 20 requests a day per model. Don't test anything that calls Gemini on the demo day before the demo. The demo uses about 3 or 4: one explanation per incident (Send Traffic opens one per app that scales, Break It one).
- **The onboarding repo.** The demo onboards `PunitXd/kairo-dockerfile-sample` and merges its setup PR. It must not already be merged: if the rehearsal merged it, revert the merge on GitHub (the PR's "Revert" button, then merge the revert PR), so Kairo opens a new PR in the demo.
- **The app slots.** Kairo runs at most 3 apps. The demo needs `kairo-node-sample` and `kairo-python-sample` running and one free slot for the onboarding, so delete `kairo-dockerfile-sample` in Kairo first (its app page → Delete, type its name). Its history stays and comes back when it is added again.

## Start, in this order

1. **DockerDisk** mounted (above).
2. **Docker Desktop.** Start it and wait until its menu says Docker and Kubernetes are running. Check:

   ```bash
   kubectl --context docker-desktop get nodes
   ```

   `docker-desktop` must be `Ready`. Then every pod in `monitoring`, `traefik` and the two app namespaces should be `Running`:

   ```bash
   kubectl --context docker-desktop get pods -A | grep -E "monitoring|traefik|kairo-"
   ```

3. **Postgres.** `kairo-db` starts by itself with Docker (`unless-stopped`). Check it is up:

   ```bash
   docker ps --filter name=kairo-db --format "{{.Names}} {{.Status}}"
   ```

   If it isn't listed: `docker start kairo-db`.
4. **Backend**, in its own terminal tab, with live healing:

   ```bash
   cd ~/Desktop/Kairo/backend && REMEDIATION_DRY_RUN=false npm start
   ```

   `npm start`, not `npm run dev`: the dev script restarts the backend whenever a file changes. Gemini follows `GEMINI_ENABLED` in `.env` (on for the demo). Within about 20 s the log shows `kairo api listening`, `port-forward open`, `Prometheus answering` and a `public link` line for each app.
5. **Frontend**, in another tab:

   ```bash
   cd ~/Desktop/Kairo/frontend && npm run dev
   ```

6. Open http://localhost:5173 and sign in with GitHub.

## Check before the audience arrives

- [ ] The pills at the top: **API up, Database up, Cluster up, Healing live, Gemini on**. "Healing dry run" means `REMEDIATION_DRY_RUN` isn't `false`: stop the backend and start it again with the command above.
- [ ] The Apps page: `kairo-node-sample` and `kairo-python-sample` **Healthy**, "2 of 3 apps", one slot free.
- [ ] Each app's public link opens, from the dashboard (see "Public links").
- [ ] The phone is on a network that reaches the internet (the public links go through Cloudflare).
- [ ] GitHub is open in a tab, signed in, on `PunitXd/kairo-dockerfile-sample`.

## The demo

The order leads with rollback and scaling, the two things Kubernetes doesn't do by itself.

1. **Sign in and pick a repo.** Apps → Add a repo → `PunitXd/kairo-dockerfile-sample` → Add. ("Give the Kairo app access to it on GitHub" shows how a new repo gets added to the installation.)
2. **Watch it onboard.** The steps tick through Cloning, Detecting, Generating, Building, Deploying, Running: about **15 to 35 s**. Show "What Kairo found" (each fact with where it came from: "looks like NODE, keeping its Dockerfile") and the generated files.
3. **The preview.** "Marking healthy in …" counts down the 60 s grace window, then "Marked healthy". Open the public link on the phone.
4. **The PR.** About 10 s after the healthy mark, the PR card shows PR #N from Kairo's bot. Open it on GitHub, show the files and the facts in its description, and merge it. GitHub Actions builds the image for amd64 and arm64 and pushes it to GHCR (about 1.5 min); Kairo sees it and rolls it out: **about 1.5 to 2 min from the merge to the new release live** (measured 97.8 s), then the release is marked healthy 60 s later. The app's Releases tab shows the GHCR release.
5. **Scaling.** On **`kairo-node-sample` or `kairo-python-sample`** (not the Dockerfile sample: it answers every path with the same small reply, so Send Traffic burns no CPU there and it never scales): Test panel → Send Traffic. 60 s of load. The chart jumps, `KairoHighCpu` fires and Kairo adds a replica **about 1 min after the click** (measured 56 to 64 s). Python may add a third a minute later (its latency alert waits 2 min). Kairo scales back to 1 **about 6 min after the load ends** (measured 5 min 47 s); come back to it at the end rather than waiting.
6. **Break It.** On `kairo-node-sample`: Test panel → Deploy a broken release → Yes, deploy it. The new release crash-loops; `KairoCrashLoop` fires; Kairo rolls back to the last healthy release **60 s after the click** (it never rolls back inside the 60 s grace window), checks it within 4 s, and the incident is resolved about 75 s after the click. Open the incident page: what happened (Gemini's explanation, a few seconds after the incident opens), the timeline, the attempt with its check, and the GitHub issue step. Open the issue on GitHub: Kairo's comment links back to the incident page.
7. **Back to scaling.** The Overview or Metrics of the app from step 5: replicas back to 1, with Kairo's actions marked on the chart.

## After the demo

- Nothing has to be stopped. To stop: Ctrl-C in the frontend and backend tabs (the backend closes its port-forward and tunnels), then quit Docker Desktop.
- The onboarded `kairo-dockerfile-sample` stays as an app; delete it in Kairo if the slot is needed.

## Public links

Each app's public link is a Cloudflare quick tunnel, and it gets a new address every time the backend restarts. On demo day, open an app's public link from the dashboard (the Apps list or the app's header) once everything has started. Never use a copy saved earlier, from a note, a chat or a previous run: it points at a tunnel that no longer exists.

## Good to know

- **Log times.** The Logs screen shows each line's time without its date. A pod that has run since an earlier day shows that day's times next to "read … UTC" of today.
- **A new app's alert rules** load in Prometheus about a minute after the app is deployed. Don't Break It or Send Traffic on an app in its first minute.
- **Give-up.** Kairo stops acting on an app after 3 counted actions in 10 minutes (scale-ups count, scale-downs don't). Keep a few minutes between Break It runs on the same app; the app page says "Needs attention" if it stopped.

## If something goes wrong

**Sign-in says "GitHub didn't answer", and the backend log shows "Read-only file system"** from Postgres: the DockerDisk SSD dropped. Docker keeps the lost disk open even after the SSD is back. Check `/Volumes/DockerDisk` is mounted, then quit Docker Desktop and start it again, wait for Kubernetes, and restart the backend. Postgres recovers by itself ("automatic recovery"); the monitoring history of the time it was down is lost.

**Prometheus restarted or "Prometheus" not answering** (the Metrics screen is empty, the backend log says the port-forward ended): the backend opens the port-forward again by itself within about 30 s. If it doesn't, restart the backend.

**A public link doesn't open:** it is from before a backend restart. Take the current one from the dashboard. A link that was just made can take a few seconds to answer.

**Gemini is off or its quota ran out:** everything still works. The incident page shows Kairo's own rule-based cause instead of an explanation, and the Gemini pill says off or down.

**An app says "Needs attention":** Kairo has stopped acting on it (give-up, or an action it couldn't confirm within 90 s); the app page says why. It clears by itself once no alert has been open for the app for 10 minutes; a manual rollback from Releases is the way to act sooner.

**"Limit of 3 running apps reached":** delete an app first (its app page → Delete).

**Kairo's Kubernetes writes are refused** (a log line or an onboarding failure saying "kairo-platform may only change kairo-&lt;app&gt; namespaces …"): the admission policy that limits Kairo's own account is in the way. Switch it off at once:

```bash
kubectl --context docker-desktop delete validatingadmissionpolicybinding kairo-platform-writes
```

Kairo works as before (without the limit) until `terraform apply` in `infra/terraform` puts it back. To see what the account may and may not write: `infra/scripts/check-platform-writes.sh`.

## Before the demo, once: a Prometheus restart

Rehearsed in P5g, at a time when Prometheus' history doesn't matter (it keeps one day and loses it on a restart):

```bash
kubectl --context docker-desktop -n monitoring delete pod -l app.kubernetes.io/component=server
```

A new pod starts within about a minute; the backend's port-forward notices the old one is gone and opens again by itself, and the Metrics screen fills in again from then on.
