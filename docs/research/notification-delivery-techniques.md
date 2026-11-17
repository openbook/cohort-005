# Getting new notifications to the browser in a React Router 8 app on one Node process

Researched 2026-11-17. Facts only; the choice is made in a separate ticket.

## Question

What can a React Router 8 app served by `react-router-serve` on one Node process use to get new notifications to the browser? This note covers four techniques: loader data refreshing on navigation, polling, Server-Sent Events (SSE) and WebSockets. For each it gives how it is done, what it costs the server given synchronous better-sqlite3, how it behaves across tabs, reconnects and background tabs, and what it takes to test.

## Context

The v1 goal for Cadence is a bell with an unread count. The app runs in framework mode with `ssr: true` (`react-router.config.ts`) and starts with `react-router-serve ./build/server/index.js`. All data sits in one SQLite file reached through Drizzle on synchronous better-sqlite3, opened once per process as a lazy singleton (`app/db/index.ts`; ADR 0006). Every query blocks the single event loop while it runs. `app/root.tsx` has no loader. The shell loader is `app/routes/layout.app.tsx` (`loader`, lines 174–217), a pathless layout that wraps every signed-in route. Routes outside it are `/`, `/signup`, `/login` and the `api/*` resource routes (`app/routes.ts`).

Installed versions, read from each `package.json` under the main checkout's `node_modules/`: `react-router` 8.3.0, `@react-router/serve` 8.3.0, `@react-router/express` 8.3.0, `@react-router/node` 8.3.0, `@react-router/dev` 8.3.0, `better-sqlite3` 12.11.1, `vitest` 5.0.5, `express` 5.2.1 (a dependency of `@react-router/serve`), `compression` 1.8.2. **`ws` is not installed.** The local Node is v24.14.1, and `@react-router/serve` requires `>=22.22.0`. The docs come from two places: the copy bundled in `node_modules/react-router/docs` (8.3.0) and reactrouter.com, which served **8.5.1** on the day. I found no difference between them on these topics.

---

## 1. Loader data refreshing on navigation

### How in React Router 8

- In framework mode with SSR, the docs say "route loaders are automatically revalidated after all navigations and form submissions (this is different from Data Mode)" ([route-module.md `shouldRevalidate`](https://reactrouter.com/start/framework/route-module#shouldrevalidate); bundled `docs/start/framework/route-module.md:485-489`).
- The source agrees. The single-fetch navigation strategy passes `defaultShouldRevalidate = true` unless an action returned 4xx/5xx (`react-router/dist/development/lib/dom/ssr/single-fetch.js:135-136`). That means the `layout.app.tsx` loader re-runs on every client-side navigation between child routes, after every action including fetcher submissions, and on every `revalidate()`.
- Doc inconsistency: the hidden page `docs/how-to/optimize-revalidation.md` says React Router avoids "reloading layout routes that aren't changing". That describes the Data Mode default in `router.js:1960-1966`, where a pathless layout keeps its pathname and is skipped. It is not the framework-mode behaviour.
- Each navigation makes one HTTP request (`/<path>.data`) that runs all matched loaders on the server. If any matched route opts out through `shouldRevalidate`, the client adds `_routes=<ids>` so that only the remaining loaders run (`single-fetch.js:176, 239`; server side `server-runtime/single-fetch.js:79-84`).
- Opt-outs: a `shouldRevalidate` export on the route (`router.js:2065-2070`), or a per-submission `defaultShouldRevalidate` option on `<Form>` and `fetcher.submit`. **Version note:** the per-submission option was added in 7.11 as `unstable_defaultShouldRevalidate` (`CHANGELOG.md:600`). In 8.3.0 the types expose it as `defaultShouldRevalidate`.
- Nothing triggers a refresh except user activity. React Router registers no `focus`, `visibilitychange` or `pageshow` listeners. Its only `pagehide` listeners save scroll positions and view-transition state (`lib/dom/lib.js:1090`, `lib/router/router.js:274`).

### Server cost

- Adding one unread-count query to the layout loader costs one query per navigation, per action and per document request. That loader already runs up to about 29 synchronous queries for a signed-in user with three recent courses (my count from `layout.app.tsx:22-217`: users, current user, recent courses, then eight queries per course, plus the team-admin check).
- Local measurement (Apple M1 Pro, Node 24.14.1, WAL file database, raw better-sqlite3 prepared statement, no Drizzle). 200,000 notification rows across 1,000 users, `select count(*) … where user_id = ? and read_at is null`:
  - **About 2.7 µs per query with an index on `(user_id, read_at)`.**
  - **About 5.5 ms without the index (full scan).** The event loop is blocked for that whole time.
  - Drizzle's query-building overhead was not measured.
- No long-lived connections. The server does not need to learn about new notifications; the next loader run reads the table.

### Tabs, reconnects, background tabs

- Each tab is independent. A tab whose user doesn't navigate or submit keeps its count for as long as it stays open.
- Hidden tabs do nothing, so there is nothing to throttle.
- bfcache: a restored page is a snapshot "including the JavaScript heap" ([MDN, Working with the bfcache](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications#working_with_the_bfcache)), and React Router has no `pageshow` handler. A page restored with Back therefore shows the count from when it was left, until the next navigation.
- There are no connections, so there is nothing to reconnect.

### Testing

- A loader is a plain async function. In v8 its arguments are `request`, `url`, `pattern`, `params` and `context` (`lib/router/utils.d.ts:178-216`). **Version note:** v8 always passes the raw request, and `url` holds the normalised URL (`CHANGELOG.md`, v8.0.0, removal of `v8_passThroughRequests`).
- Repo grounding:
  - Existing tests cover only `app/lib/*` functions that take `db` as a parameter. They use a fresh in-memory database built from the real migrations (`app/test/setup.ts:19-29`; e.g. `getSeatAvailability(db, seat)` at `app/lib/refunds.server.ts:111`).
  - Route loaders import the `db` singleton bound to `data.db` (`app/db/index.ts`). Testing a loader directly therefore needs `vi.mock("~/db")` or the count moved into a `db`-taking function.
  - Session mocking already exists (`vi.mock("~/lib/session")` in `app/lib/country.server.test.ts:5-9`).
- The revalidation behaviour itself belongs to the framework. Asserting "the count updates after navigating" needs a rendered router (`createRoutesStub`, [testing.md](https://reactrouter.com/start/framework/testing)) plus a DOM environment, or a real browser.
  - The repo has no `jsdom`, `happy-dom`, `@testing-library/react` or Playwright. Vitest runs with its default `node` environment (`vitest.config.ts`).
  - Unconfirmed: whether `createRoutesStub` reproduces framework-mode single-fetch revalidation, or Data Mode rules.

---

## 2. Polling

### How in React Router 8

**`useRevalidator().revalidate()` on an interval.** The hook is documented for "polling on an interval" (`lib/hooks.d.ts:539-577`; [reactrouter.com useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)).

- `router.revalidate()` (`router.js:473-488`) first calls `interruptActiveLoads()` (`router.js:1090-1095`). That aborts in-flight fetcher loads and marks revalidation as required.
- When navigation is idle it starts an "uninterrupted revalidation", which does not update `navigation.state` (`router.js:493, 655`). As a result the `NavigationLoadingBar` in `app/root.tsx:58-70`, which reads `useNavigation()`, does not show during a poll. `revalidator.state` becomes `"loading"` instead.
- Each poll re-runs **every active loader**: the layout loader plus the current child route's loader, in one `.data` request. It also re-runs every loaded fetcher.

**`useFetcher().load(href)` on an interval against a resource route** (for example a new `api/notifications/unread-count` route with no default export; see [resource-routes.md](https://reactrouter.com/how-to/resource-routes)).

- The fetcher strategy calls **only the target route** (`single-fetch.js:210-219`), and the server filters to it with `_routes` (`server-runtime/single-fetch.js:79-84`).
- For fetcher consumers the docs advise returning `data()` or plain objects rather than `Response` (resource-routes.md, "Return Types").
- Fetcher state is keyed and is deleted when the owning component unmounts (`lib/dom/lib.js:959-962`). A bell in the layout persists across child navigations.
- A loaded fetcher is re-run "after action submissions and explicit revalidation requests via `useRevalidator`" (`docs/how-to/optimize-revalidation.md`; `router.js:2003-2006`). It only re-runs while its owning route is still matched (`router.js:1975`). A "mark all as read" action therefore refreshes the bell fetcher too.
- Errors: a fetcher error goes to the nearest `ErrorBoundary` above the route that owns the fetcher (`router.js:975-977, 1102-1109`; resource-routes.md:118). `layout.app.tsx` exports no `ErrorBoundary`, so a failing poll from a fetcher there renders `root.tsx`'s `ErrorBoundary` (line 81) in place of the page. I did not trace the network-failure path (server down) end to end.

**Plain `setInterval` with `fetch()`** to a resource route that returns `Response.json(...)`. This runs outside the router. It is not refreshed after actions unless the app triggers it.

### Server cost

- Each poll is one HTTP request that parses the session cookie (`getCurrentUserId`, `app/lib/session.ts`).
  - `revalidate()` runs the layout loader (up to about 29 queries) plus the child loader.
  - A fetcher or `fetch` poll runs one count query (about 3 µs indexed, as measured above).
  - Express and React Router per-request overhead was not measured.
- Load grows with open tabs ÷ interval. For example, 200 open tabs polling every 30 s make about 6.7 requests a second. With `revalidate()` that is about 6.7 × 29+ queries a second; with a fetcher it is 6.7 count queries a second.
- No long-lived connections. The server needs no knowledge of new notifications. Latency is up to one interval.

### Tabs, reconnects, background tabs

- Every tab polls on its own timer, so N tabs make N times the requests.
- Background timer throttling ([MDN setTimeout, "Timeouts in inactive tabs"](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#timeouts_in_inactive_tabs); [Chrome: timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)):
  - Chrome checks hidden-tab timers once per second.
  - Chrome's "intensive throttling" checks them once per minute when the page has been hidden for more than 5 minutes, the chain count is 5 or more, the page has been silent for 30 s, and WebRTC is not in use. Both MDN and Chrome describe chained timer calls. That a `setInterval` counts as a chain is my reading of the Chrome article.
  - Firefox desktop sets a 1 s minimum in inactive tabs. Firefox for Android sets 15 minutes "and may unload them entirely".
  - MDN also describes budget-based throttling in background tabs ([Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)).
  - Net effect: a 30 s poll in a long-hidden Chrome tab can fire at most about once a minute.
- `visibilitychange` and `document.visibilityState` let the app pause and resume polling (MDN Page Visibility).
- Frozen tabs: "JavaScript timers and fetch callbacks don't run". Discarded tabs are unloaded ([Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- bfcache: browsers "pause any pending timers" for pages in bfcache ([web.dev bfcache](https://web.dev/articles/bfcache)), and they resume on restore. Polling holds no connection open, so it is not among the listed bfcache blockers (WebSocket, WebRTC, IndexedDB).
- Reconnects: there are none. A failed poll is a single failed request, though see the `ErrorBoundary` point above.

### Testing

- A resource route loader can be called directly and its returned object asserted, with the same `db` injection or mocking question as in §1.
- The polling hook needs a component test: a DOM environment, `@testing-library/react` and `createRoutesStub` (none installed), plus fake timers.
  - The repo already uses `vi.useFakeTimers()` (`app/lib/utils.test.ts:6`, `app/lib/analytics.test.ts:99`).
  - `vi.advanceTimersByTimeAsync` runs timers including async ones. `useFakeTimers` does not fake `process.nextTick` or `queueMicrotask` by default ([Vitest `vi` API](https://vitest.dev/api/vi), docs at v5.1.0).
- Background throttling, freezing and bfcache only show up in a real browser.

---

## 3. Server-Sent Events from a resource route

### How in React Router 8

- Server side: a resource route loader returns `new Response(readableStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })`.
  - The server runtime returns a `Response` from a resource route unchanged (`server-runtime/server.js:117, 308-329`).
  - `@react-router/express` calls `res.flushHeaders()` when the content type matches `text/event-stream` (`@react-router/express/dist/index.js:63`). It then pipes the body through `writeReadableStreamToWritable`, which calls `flush()` after every chunk when one exists (`@react-router/node/dist/index.js:107-122`).
- Compression: `react-router-serve` mounts `compression()` for non-RSC builds (`@react-router/serve/dist/cli.js:113`). `compressible` treats `text/*` as compressible, so SSE responses are gzipped. The `compression` README says SSE needs `res.flush()` per event (`node_modules/compression/README.md:252-283`); React Router's writer makes that call.
  - **Verified locally** with Express, `compression` and the real writer: the response came back `content-encoding: gzip`, and three events arrived about 700 ms apart, as sent.
- Disconnects: the Express adapter aborts `request.signal` when the response closes (`@react-router/express/dist/index.js:47-48`). The writer rejects on `close` and cancels the stream reader (`@react-router/node/dist/index.js:124-128, 159-160`), so the `ReadableStream`'s `cancel()` runs.
  - **Verified locally** through `@react-router/express`'s `createRequestHandler` with a hand-built stub server build: aborting the client fetch fired both `request.signal` abort and `cancel()`.
  - Express also appended `; charset=utf-8` to the content type. The spec checks the MIME type, so this does not break the stream.
- Browser side: `new EventSource("/api/notifications/stream")` in an effect, closed with `close()` ([MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)). Same-origin requests carry the session cookie; `withCredentials` only matters for CORS. This runs outside React Router's data APIs.
- Status matters. If the response "status is not 200, or if res's Content-Type is not text/event-stream, then fail the connection", and "once the user agent has failed the connection, it does not attempt to reconnect" ([WHATWG HTML, Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)). In this repo, a stream route that throws 401 for a missing user (the DevUI case in `CLAUDE.md`) would stop the `EventSource` for good.

### Server cost

- One open socket per tab, held for the life of the page.
  - `react-router-serve` listens with Express `app.listen` (`cli.js:127`), which is a plain Node HTTP/1.1 server with no HTTP/2.
  - Node's defaults don't cut these connections: `server.timeout` defaults to 0 (no timeout). `requestTimeout` (300 s) covers receiving the request, not sending the response ([Node http](https://nodejs.org/api/http.html)).
  - Proxies can drop idle connections. The spec suggests "a comment line … every 15 seconds or so", which means one timer per connection or a shared one.
- Queries: one count when each connection opens, then one per change for the affected user's connections. The cost depends on how the server learns of changes (see §5). If each connection runs its own timer and re-queries, N connections make N queries per tick.
- Shutdown: on SIGTERM or SIGINT, `react-router-serve` calls `server.close()` (`cli.js:128-130`). That "closes all connections … which are not sending a request or waiting for a response" (Node http). An open SSE stream is still sending a response, so it stays open until it ends. `react-router-serve` does not call `closeAllConnections()`. This is derived from the docs; I did not test it.
- Memory per open connection was not measured.

### Tabs, reconnects, background tabs

- Connection limit: "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections … the limit is per browser + domain … (6)". Over HTTP/2 the stream limit is negotiated, defaulting to 100 (MDN EventSource).
  - With `react-router-serve` serving directly, only six SSE connections per browser are open at once, across all tabs. HTTP/2 applies only if a proxy terminates it in front.
  - The spec notes per-server limits "might run into trouble when opening multiple pages", and suggests sharing one `EventSource` through a shared worker.
  - Unconfirmed from a primary source: whether other requests from the same browser (navigations, `.data`) queue behind the held connections.
- Reconnect is automatic. The reconnection time is "implementation-defined … probably in the region of a few seconds". The server can set it with `retry:`, and user agents "might introduce an exponential backoff". If events carried an `id:`, the browser sends `Last-Event-ID` on reconnect (WHATWG). For a count, the server can simply send the current value on every connect.
- Background tabs: events arrive from the network, not from timers. MDN's list of connections exempt from throttling names WebSockets and WebRTC only (MDN Page Visibility). How hidden-tab throttling affects `EventSource` dispatch is unconfirmed. In frozen tabs fetch callbacks don't run, and Chrome advises closing connections on `freeze` and reopening on `resume` (Chrome Page Lifecycle API).
- bfcache: in the HTML spec's unloading cleanup steps, an open `WebSocket` makes the document unsalvageable. An `EventSource` is only force-closed when the document is already unsalvageable ([WHATWG document lifecycle](https://html.spec.whatwg.org/multipage/document-lifecycle.html)). Unconfirmed: whether each browser keeps pages with an open `EventSource` eligible for bfcache. Closing on `pagehide` and reopening on `pageshow` when `event.persisted` is true is the pattern MDN gives for WebSockets.

### Testing

- Call the loader directly and read `response.body.getReader()` with a `TextDecoder`. Pass `new Request(url, { signal })` and abort it to test cleanup. Use `vi.advanceTimersByTimeAsync` for heartbeats. An in-process emitter can be triggered from the test. All of this runs in Vitest's `node` environment.
- A full-stack check without a browser is possible: Express plus `@react-router/express` on a random port, read with Node `fetch`. That is how the verification above was done. Compression and flushing are only visible at this level.
- Client side: Node's `EventSource` global is "Experimental. Enable this API with the `--experimental-eventsource` CLI flag" ([Node globals](https://nodejs.org/api/globals.html)). Testing the browser hook needs a DOM environment with an `EventSource` stand-in, or a real browser. Reconnect timing, the six-connection limit, freezing and bfcache need a real browser.

---

## 4. WebSockets

### How in React Router 8, and whether `react-router-serve` allows it

**`react-router-serve` cannot accept WebSocket connections.** From `@react-router/serve/dist/cli.js` (8.3.0):

- Lines 111–126 build an Express app with `compression`, static file handlers, `morgan` and one `app.all("/{*splat}", createRequestHandler(...))`.
- Line 127 calls `app.listen` and stores the server in a local variable. That variable is used only to call `server.close` on signals (lines 128–130).
- The server is never exported or passed to the build. No `upgrade` listener is registered, and the CLI takes no option for one. The only build-supplied config, `unstable_reactRouterServeConfig`, is read only for RSC builds (lines 93–103).

What then happens to a WebSocket handshake:

- Node: with no listener, "all HTTP upgrade requests are ignored (i.e. only regular `'request'` events are emitted …)". Since v24.9.0 and v22.21.0 the `shouldUpgradeCallback` option defaults to `() => server.listenerCount('upgrade') > 0` ([Node http, `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade)).
- The handshake therefore reaches React Router as an ordinary GET. The handler receives a Fetch `Request` with no socket (`@react-router/express/dist/index.js:33-54`), so a loader cannot complete the 101 handshake.
- **Verified locally** with Express `app.listen` (the same set-up) and Node 24's `WebSocket` client: the catch-all handler logged `GET /ws upgrade=websocket`, and the client closed with code 1006.

With a custom server:

- The docs list the `node-custom-server` template ([deploying.md](https://reactrouter.com/start/framework/deploying), bundled `docs/start/framework/deploying.md:44-50`). Its [`server.js`](https://github.com/remix-run/react-router-templates/blob/main/node-custom-server/server.js) (read on `main`) is Express plus `app.listen`. The `http.Server` that returns can take an `upgrade` listener handed to a WebSocket library.
  - `ws` is not installed. Node's `WebSocket` global is a client ("A browser-compatible implementation of `<WebSocket>`", Node globals).
  - That needs a new `start` script. Dev also needs a change: the repo's `dev` script runs `react-router dev`, which uses Vite's own server, and the template wires dev through Vite `middlewareMode`.
  - **Version note:** in v8, a custom server's `getLoadContext` must return a `RouterContextProvider`; plain objects were dropped with `v8_middleware` (`CHANGELOG.md`, v8.0.0; `docs/how-to/middleware.md:96-106`).
- Untested alternative inside `react-router-serve`: server-build code could open a second listener on another port at import time, in the same process. The page and socket would then be different origins. Cookies "do not provide isolation by port" ([RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)).

### Server cost

- One upgraded socket per tab. `closeAllConnections()` "does not destroy sockets upgraded to a different protocol, such as WebSocket" (Node http), so shutdown has to track and close them.
- Authentication: the handshake carries the session cookie, but it arrives outside React Router's request pipeline, so the session has to be parsed separately (`app/lib/session.ts` takes a `Request`).
- Queries and change detection are the same as for SSE (§5).

### Tabs, reconnects, background tabs

- No automatic reconnect. MDN describes `close` and `error` events; its only reconnection example creates a new `WebSocket` on `pageshow` ([MDN, Writing WebSocket client applications](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)). Backoff and resync are application code.
- Background: "Tabs running code that's using real-time network connections (WebSockets and WebRTC) go unthrottled" (MDN Page Visibility). Frozen tabs: Chrome advises closing WebSockets.
- bfcache: an open `WebSocket` makes the document unsalvageable with the reason `"websocket"` (WHATWG document lifecycle). MDN advises closing it on `pagehide`.
- Per-origin connection limits for WebSockets were not checked; the six-connection statement on MDN is about SSE.

### Testing

- Integration tests need a real `http.Server` with the upgrade handler. Node 22.4+ ships a stable `WebSocket` client (Node globals), so Vitest in the `node` environment can drive it without a browser.
- Reconnect logic is custom and testable with fake timers. bfcache and freeze behaviour need a real browser.
- The custom server entry is a new file outside `app/`. Covering it with tests is new work.

---

## 5. Cross-cutting: how one process learns of a new notification

- **In-process `EventEmitter`.** Every write made by the app goes through the one process and the one connection (ADR 0006; `app/db/index.ts`), so the code that inserts a notification can emit an event straight after the insert.
  - "The `EventEmitter` calls all listeners synchronously in the order in which they were registered" ([Node events](https://nodejs.org/api/events.html)), so the fan-out runs inside the request that wrote the row.
  - With one listener per SSE or WebSocket connection, more than 10 listeners on one event prints a "possible EventEmitter memory leak" warning unless `setMaxListeners` is raised. This is a warning, not a hard limit.
  - Writes from other processes (`scripts/seed.ts` via `tsx`, `drizzle-kit`, the sqlite CLI) never reach the emitter.
- **Server-side polling of the database.** One process-wide timer checks for changes and fans out to open connections. This does not apply to client polling, where the browser's request is the check.
  - Option: `max(id)` on the notifications table. This is one query per tick, whatever the number of connections.
  - Option: `PRAGMA data_version`. Its value changes "if changes were committed to the database by any other connection" but "is unchanged for commits made on the same database connection" ([SQLite pragma](https://www.sqlite.org/pragma.html#pragma_data_version)). The app uses one connection, so this would detect writes from other processes only.
  - better-sqlite3 documents no update or commit hook; its `Database` methods are `prepare`, `transaction`, `pragma`, `explain`, `backup`, `serialize`, `function`, `aggregate`, `table`, `loadExtension`, `exec` and `close` ([better-sqlite3 api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)).
- **Query cost.** Each query blocks the event loop. better-sqlite3 says SQLite is serialised regardless of API, and names "a high volume of concurrent writes" as a case where it could be inappropriate ([better-sqlite3 README](https://github.com/WiseLibs/better-sqlite3)). The indexed count measured above was about 2.7 µs.

---

## Comparison

| | Loader on navigation | Poll: `revalidate()` | Poll: fetcher or `fetch` to resource route | SSE resource route | WebSocket |
|---|---|---|---|---|---|
| Works with `react-router-serve` as is | Yes | Yes | Yes | Yes (flush through `compression` verified) | No; needs a custom server and a WS library (not installed) |
| Delay before a new notification shows | Until next navigation or action | Up to one interval | Up to one interval | Push (immediate) | Push (immediate) |
| Server work per update | Every navigation or action runs all matched loaders | Per tab per tick: layout plus child loaders (~29+ queries) | Per tab per tick: one count query | Count on connect and on change | Count on connect and on change |
| Long-lived connections | None | None | None | One HTTP/1.1 socket per tab | One upgraded socket per tab |
| Server must learn of new rows | No | No | No | Yes (emitter or server-side poll) | Yes (emitter or server-side poll) |
| Multiple tabs | Independent | N× requests | N× requests | Max 6 per browser over HTTP/1.1 | Limit not checked |
| Reconnect | n/a | n/a | n/a | Automatic, `retry`, `Last-Event-ID` | Application code |
| Hidden or background tab | Nothing runs | Timers throttled (down to once a minute in Chrome) | Same as left | Throttling effect unconfirmed | Exempt from throttling (MDN) |
| bfcache | Stale until next navigation | Timers paused, resume on restore | Same as left | Eligibility unconfirmed | Blocks it (spec reason `websocket`) |
| Tested without a browser | Loader yes; revalidation no | Loader yes; hook needs DOM env plus RTL (not installed) | Same as left | Loader stream and Node-level integration yes; `EventSource` client no | Server plus Node `WebSocket` client yes |

## Sources

React Router (installed 8.3.0 source under `node_modules/`, docs bundled in `node_modules/react-router/docs`, and reactrouter.com at 8.5.1)
- `@react-router/serve/dist/cli.js` (whole file, 133 lines); `@react-router/express/dist/index.js:17-74`; `@react-router/node/dist/index.js:107-175`
- `react-router/dist/development/lib/router/router.js:473-493, 655, 975-977, 1090-1109, 1925-2070`; `lib/dom/ssr/single-fetch.js:125-187, 210-239`; `lib/server-runtime/server.js:105-117, 308-329`; `lib/server-runtime/single-fetch.js:79-84`; `lib/hooks.js:910-920`; `lib/hooks.d.ts:539-577`; `lib/dom/lib.js:946-974, 1090, 1172-1180`; `lib/router/utils.d.ts:178-216`; `react-router/CHANGELOG.md` (v8.0.0, v7.11.0)
- https://reactrouter.com/start/framework/route-module#shouldrevalidate · https://reactrouter.com/api/hooks/useRevalidator · https://reactrouter.com/how-to/fetchers · https://reactrouter.com/how-to/resource-routes · https://reactrouter.com/start/framework/testing · https://reactrouter.com/start/framework/deploying · bundled `docs/how-to/optimize-revalidation.md`, `docs/how-to/middleware.md`
- https://github.com/remix-run/react-router-templates/blob/main/node-custom-server/server.js

Web platform
- MDN EventSource: https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- WHATWG HTML, Server-sent events: https://html.spec.whatwg.org/multipage/server-sent-events.html
- WHATWG HTML, document lifecycle (unloading cleanup steps): https://html.spec.whatwg.org/multipage/document-lifecycle.html
- MDN WebSockets API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API · Writing WebSocket client applications: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications
- MDN Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN setTimeout, inactive tabs: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- Chrome, Timer throttling in Chrome 88: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- Chrome, Page Lifecycle API: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- web.dev (Chrome team), Back/forward cache: https://web.dev/articles/bfcache
- RFC 6265 §8.5: https://www.rfc-editor.org/rfc/rfc6265#section-8.5

Node, SQLite, tooling
- Node http (`'upgrade'`, `shouldUpgradeCallback`, timeouts, `close`, `closeAllConnections`), docs at v26.13.1: https://nodejs.org/api/http.html
- Node globals (`EventSource`, `WebSocket`): https://nodejs.org/api/globals.html
- Node events: https://nodejs.org/api/events.html
- better-sqlite3 README and API: https://github.com/WiseLibs/better-sqlite3 · https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- SQLite `PRAGMA data_version`: https://www.sqlite.org/pragma.html#pragma_data_version
- `compression` README (SSE section): `node_modules/compression/README.md:252-283`
- Vitest `vi` API (docs at v5.1.0): https://vitest.dev/api/vi

Local measurements (2026-11-17; throwaway scripts, deleted afterwards): SSE flushing through `compression`; abort and cancel through `@react-router/express`; WebSocket upgrade against plain Express `app.listen`; unread-count timing on better-sqlite3 12.11.1.
