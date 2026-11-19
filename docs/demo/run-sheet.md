# Kairo demo run sheet

What to start, in what order, what to check, the demo itself step by step, and what to do when something gets in the way. The times come from the measured runs (note 06, P5f), so you can tell at a glance whether a step is late.

## The day before

- **Disk.** Docker Desktop keeps its disk on the external SSD **DockerDisk**. It must be plugged in and mounted (`ls /Volumes/DockerDisk`) before Docker Desktop starts, and stay plugged in. If it drops, everything stops (see "If something goes wrong"). The Mac's own disk should have a few GB free (`df -h /`).
- **Power and sleep.** Charger in. Turn off sleep on power (System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when the display is off"), or run `caffeinate -dims` in a terminal tab for the whole demo.
- **Gemini.** The key is on the free tier, about 20 requests a day per model. Don't test anything that calls Gemini on the demo day before the demo. The demo uses about 3 or 4: one explanation per incident (Send Traffic opens one per app that scales, Break It one).
- **The onboarding repo.** The live onboarding is `PunitXd/kairo-demo-python`, a copy of `sample-apps/python-sample` with no Dockerfile, Kubernetes or workflow files, so Kairo generates all of them (the Dockerfile for Python is the thing to show). It must be fresh: never onboard it before the demo, and check it is in the Kairo app's installation. `kairo-node-sample` and `kairo-python-sample` stay untouched for Send Traffic and Break It. `PunitXd/kairo-dockerfile-sample` (its pull request 1 open, never merged) is the optional extra at the end. Rehearsals use another repo (`PunitXd/kairo-demo-rehearsal`), never these.
- **The app slots.** Kairo runs at most 3 apps. The demo needs `kairo-node-sample` and `kairo-python-sample` running and one free slot for `kairo-demo-python`, so delete every other app in Kairo first (its app page → Delete, type its name): `kairo-demo-rehearsal` after a rehearsal, and `kairo-dockerfile-sample` if it is listed. Deleting in Kairo leaves the GitHub repo and its PR alone; the app's history stays and comes back when it is added again.

## Start, in this order (the morning of the demo)

The Mac runs everything; the college PC (or any browser) opens Kairo through one public address, a Cloudflare tunnel to the backend. Sleep is off (`pmset`), so the lid can stay closed once it is all running.


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
4. **Build the frontend** (once, after any change to `frontend/`):

   ```bash
   cd ~/Desktop/Kairo/frontend && npm run build
   ```

5. **The public tunnel**, in its own terminal tab, left running all day:

   ```bash
   cloudflared tunnel --no-autoupdate --url http://localhost:4000
   ```

   Copy the `https://….trycloudflare.com` address it prints. It stays the same until this command stops; restarting the backend doesn't change it. If it ever restarts, the address is new: do steps 6 and 7 again with it.
6. **GitHub App callback URL** for that address: github.com/settings/apps → Kairo → General → Callback URL → Add callback URL → `https://<tunnel address>/api/auth/callback` → **Save changes** at the bottom. Keep the localhost entry. Without it, GitHub stops sign-in with "The redirect_uri is not associated with this application".
7. **Backend**, in its own terminal tab, with live healing, serving the built dashboard on the tunnel address:

   ```bash
   cd ~/Desktop/Kairo/backend && APP_URL=https://<tunnel address> SERVE_FRONTEND=true REMEDIATION_DRY_RUN=false npm start
   ```

   `npm start`, not `npm run dev`: the dev script restarts the backend whenever a file changes. `APP_URL` on the command wins over `.env`, which keeps localhost for development. Gemini follows `GEMINI_ENABLED` in `.env` (on for the demo). Within about 20 s the log shows `kairo api listening`, `port-forward open`, `Prometheus answering` and a `public link` line for each app.
8. **Phone on mobile data** (Wi-Fi off): open `https://<tunnel address>` and sign in with GitHub. The Apps page must load. The backend log shows `PunitXd signed in`. This proves the address works from outside this network, as the college PC needs.
9. **On the college PC:** open the same address and sign in yourself. Afterwards, sign out of Kairo (Sign out in the dashboard) **and** out of GitHub on github.com, so nobody after you uses either account.

The local dev server (`npm run dev` in `frontend/`, http://localhost:5173) isn't needed for the demo; with it, sign-in also goes through the tunnel address, since that is `APP_URL`.

## Check before the audience arrives

- [ ] The pills at the top: **API up, Database up, Cluster up, Healing live, Gemini on**. "Healing dry run" means `REMEDIATION_DRY_RUN` isn't `false`: stop the backend and start it again with the command above.
- [ ] The Apps page: `kairo-node-sample` and `kairo-python-sample` **Healthy**, "2 of 3 apps", one slot free.
- [ ] The dashboard opens and signs in on the tunnel address from the phone on mobile data (step 8).
- [ ] Each app's public link opens, from the dashboard (see "Public links").
- [ ] The phone is on a network that reaches the internet (the public links go through Cloudflare).
- [ ] GitHub is open in a tab, signed in, on `PunitXd/kairo-demo-python`.

## The demo

The order leads with rollback and scaling, the two things Kubernetes doesn't do by itself.

1. **Sign in and pick a repo.** Apps → Add a repo → `PunitXd/kairo-demo-python` → Add. ("Give the Kairo app access to it on GitHub" shows how a new repo gets added to the installation.)
2. **Watch it onboard.** The steps tick through Cloning, Detecting, Generating, Building, Deploying, Running: about **15 to 35 s** (longer if the Python base image isn't pulled yet). Show "What Kairo found" (each fact with where it came from: Python from `requirements.txt`, the start command from `app.py`) and the generated files, above all the **Dockerfile Kairo wrote for Python**.
3. **The preview.** "Marking healthy in …" counts down the 60 s grace window, then "Marked healthy". Open the public link on the phone.
4. **The PR.** About 10 s after the healthy mark, the PR card shows Kairo's setup PR from its bot. Open it on GitHub, show the files and the facts in its description, and merge it. GitHub Actions builds the image for amd64 and arm64 and pushes it to GHCR (about 1.5 min); Kairo sees it and rolls it out: **about 1.5 min from the merge to the new release live** (measured 83 and 98 s), then the release is marked healthy 60 s later. The app's Releases tab shows the GHCR release.
5. **Scaling.** On **`kairo-node-sample` or `kairo-python-sample`** (not the freshly onboarded app in its first minute, and never the Dockerfile sample: it answers every path with the same small reply, so Send Traffic burns no CPU there and it never scales): Test panel → Send Traffic. 60 s of load. The chart jumps, `KairoHighCpu` fires and Kairo adds a replica **about 1 min after the click** (measured 53 to 64 s). Python may add a third a minute later (its latency alert waits 2 min). Kairo scales back to 1 **6 to 7 min after the load ends** (measured 5 min 47 s and 6 min 31 s); come back to it at the end rather than waiting.
6. **Break It.** On `kairo-node-sample`: Test panel → Deploy a broken release → Yes, deploy it. The new release crash-loops; `KairoCrashLoop` fires; Kairo rolls back to the last healthy release **60 s after the click** (it never rolls back inside the 60 s grace window), checks it within 4 s, and the incident is resolved **75 to 95 s after the click** (when Alertmanager next reports the alert resolved). Open the incident page: what happened (Gemini's explanation, a few seconds after the incident opens), the timeline, the attempt with its check, and the GitHub issue step. Open the issue on GitHub: Kairo's comment links back to the incident page.
7. **Back to scaling.** The Overview or Metrics of the app from step 5: replicas back to 1, with Kairo's actions marked on the chart.
8. **Optional, if time allows: a kept Dockerfile.** Once `kairo-demo-python`'s PR is merged and live, delete it in Kairo (its app page → Delete, type its name) to free the slot, then Apps → Add a repo → `PunitXd/kairo-dockerfile-sample` → Add. "What Kairo found" says it keeps the repo's own Dockerfile ("looks like NODE, keeping its Dockerfile"), and its setup PR is the open pull request 1, brought up to date rather than a new one. Don't merge it unless there is time for the 1.5 min rollout.

## After the demo

- On the college PC: sign out of Kairo and of GitHub (step 9).
- Nothing has to be stopped. To stop: Ctrl-C in the backend tab (it closes its port-forward and the app tunnels) and in the public tunnel tab, then quit Docker Desktop.
- The onboarded `kairo-demo-python` (or `kairo-dockerfile-sample`) stays as an app; delete it in Kairo if the slot is needed.

## Public links

The dashboard's own address is the tunnel from step 5. Each app's public link is a separate Cloudflare quick tunnel, and it gets a new address every time the backend restarts. On demo day, open an app's public link from the dashboard (the Apps list or the app's header) once everything has started. Never use a copy saved earlier, from a note, a chat or a previous run: it points at a tunnel that no longer exists.

## Good to know

- **Log times.** The Logs screen shows each line's time without its date. A pod that has run since an earlier day shows that day's times next to "read … UTC" of today.
- **A new app's alert rules** load in Prometheus about a minute after the app is deployed. Don't Break It or Send Traffic on an app in its first minute.
- **Give-up.** Kairo stops acting on an app after 3 counted actions in 10 minutes (scale-ups count, scale-downs don't). Keep a few minutes between Break It runs on the same app; the app page says "Needs attention" if it stopped.

## If something goes wrong

**Sign-in says "GitHub didn't answer", and the backend log shows "Read-only file system"** from Postgres: the DockerDisk SSD dropped. Docker keeps the lost disk open even after the SSD is back. Check `/Volumes/DockerDisk` is mounted, then quit Docker Desktop and start it again, wait for Kubernetes, and restart the backend. Postgres recovers by itself ("automatic recovery"); the monitoring history of the time it was down is lost.

**Prometheus restarted or "Prometheus" not answering** (the Metrics screen is empty, the backend log says the port-forward ended): the backend opens the port-forward again by itself within about 30 s. If it doesn't, restart the backend.

**The dashboard address doesn't open:** check the public tunnel tab is still running and the backend was started with `APP_URL` set to that address. A new tunnel address needs steps 6 and 7 again.

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

Not rehearsed yet (skipped in the P5g rehearsal); do it at a time when Prometheus' history doesn't matter (it keeps one day and loses it on a restart):

```bash
kubectl --context docker-desktop -n monitoring delete pod -l app.kubernetes.io/component=server
```

A new pod starts within about a minute; the backend's port-forward notices the old one is gone and opens again by itself, and the Metrics screen fills in again from then on.
