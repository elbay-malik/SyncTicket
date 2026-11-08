# 0011 — Serve the app as static files, and put both hosts behind the zone

**Status:** Accepted
**Date:** 2026-11-08

## Context

Until now every page load ran the app's Worker: adapter-cloudflare rendered each page on the
server, and only scripts, styles and the search model came from static assets. On the free plan
a Worker run counts against one account-wide budget of 100,000 requests a day, shared with the
relay, and when it runs out every Worker on the account answers Error 1027 until 00:00 UTC
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Requests that
Cloudflare answers from static assets alone are free and do not count
([pricing](https://developers.cloudflare.com/workers/platform/pricing/#static-assets)). ADR 0004
records that no code in this repo could stop a flood of ordinary requests from using up the
budget.

The server render carried nothing of the visitor's: the issues live in the browser
(ADR 0001), so the HTML was the same empty shell for everyone. What the server did add was a
handful of headers, a redirect to HTTPS, a `noindex` for workspace pages, and a redirect for paths
`decodeURI` refuses (`src/hooks.server.ts`, removed here).

Both Workers also answered on `workers.dev`. Zone rules, such as a rate limit or a block on
anything that is not a socket upgrade, and zone settings, such as Always Use HTTPS, apply only to
hosts in the zone, so the `workers.dev` addresses were a way around all of them.

## Decision

Build the app with adapter-static into `build/`, with server rendering off and one fallback
page, and deploy it as an assets-only Worker (no `main`) whose unmatched addresses get that page
(`not_found_handling: "single-page-application"`). Move what the server did into the files that
are served: the headers into `static/_headers`, the HTTPS redirect into the zone setting, with an inline fallback at
the top of `src/app.html`, and `noindex` into a robots tag the layout and the error page render.
Serve the relay from `syncticket-relay.elbaymalik.com` and turn `workers.dev` and preview
addresses off for both Workers.

## Consequences

- No number of page loads touches the daily budget. The relay still does, one request per socket
  upgrade plus messages at 20:1; zone rules on its host are what stand in front of that now.
- Paths `decodeURI` refuses are still sent to their `%25`-encoded form: Cloudflare's asset server
  does that itself, with a 307, and a middleware in `vite.config.ts` does the same for `vite dev`. It also resolves an encoded `%2F` (`/issues/..%2Fboard` goes to
  `/board`), which the server render left alone. Either way the visitor stays on this site in
  the same workspace (`e2e/hostile-issue-id.e2e.ts`).
- Every response but the scripts and model files carries `Cache-Control: no-transform`, which
  stops the zone injecting its Web Analytics beacon into the page; that beacon reports the page's
  address, and a workspace's address is the access to it. The same directive turns off edge
  compression, so `static/_headers` takes it off the scripts, styles and model files again.
- Every address answers 200 with the same page. A missing page says so in the browser and carries
  a robots `noindex` tag; it no longer has a 404 status.
- `_headers` rules see the path but not the query, so a page opened through a `?ws=` link gets
  its `noindex` from the page's own tag rather than a header. Crawlers that do not run scripts
  will not see it.
- Plain HTTP is redirected by the zone's Always Use HTTPS, before any page is served, and HSTS
  keeps a browser from asking over HTTP again. The script in `src/app.html` is only a fallback
  for the live host should that setting ever be off; it runs after the page has arrived, and
  leaves every local and LAN server alone.
- The first paint is the empty document until the app's scripts run, where it used to be the
  server-rendered shell. The colour scheme is still set before it, by an inline script in
  `src/app.html` that does what mode-watcher's server-rendered one did.
- A fork without the owner's zone removes the two `routes` entries, turns `workers_dev` back on
  and lists its own app's origin in the relay's `ALLOWED_ORIGINS` (docs/DEPLOY.md).

## Alternatives considered

- **Prerender each route with server rendering on.** The same free requests, and the shell
  would paint before the scripts run. Not taken for now: the issue route is dynamic and needs
  the fallback page anyway, and two kinds of page would mean two sets of behaviour to test.
- **Keep the server render and rate-limit in the Worker.** A request the Worker refuses has
  already been counted, so it cannot protect the budget.
- **A zone rate limit in front of the server-rendered pages.** The free plan allows one rule, at
  10-second periods; one address could still spend most of a day's budget under it. Static files
  need no rule.
