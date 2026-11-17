# Hosted notification services compared with building on SQLite

Research for the ticket "Hosted notification services compared with building on SQLite", part of the "In-app notifications spec" map. Sources read on 2026-11-17. Facts only. Choosing between these is a separate ticket.

The v1 being compared: a bell with an unread count, a list, and mark as read, for Students, Instructors, Platform Admins and Team Admins. Cadence runs as one `react-router-serve` process with one SQLite file through Drizzle (ADR 0006).

## Summary table

Prices are monthly list prices from each vendor's pricing page.

| | Free tier | First paid tier | How usage is counted | Does in-app count? | Inbox UI | Real-time | Branding on free |
|---|---|---|---|---|---|---|---|
| Knock | 10,000 messages | Starter $250, 50,000 messages, then $0.005 each | Per message: one user, one channel | Yes (in-app feed is a channel) | `@knocklabs/react` | Websocket, Knock-hosted | Knock branding shown |
| Novu (Cloud) | 10,000 workflow runs, 5 workflows, 24 h activity retention | Pro from $30, 30,000+ runs, $1.20 per 1,000 over | Per workflow run, per subscriber after fan-out | One run covers all channels in the workflow | `@novu/react` `<Inbox />` | Real-time, Novu-hosted | "Powered by Novu"; removal is paid only |
| MagicBell | 1,000 deliveries | Startup $249, 50,000 deliveries, then $0.0025 each | Per delivery, per channel | Yes | `@magicbell/react` | Persistent connection, MagicBell-hosted | Not stated |
| Courier | 10,000 sends | Business: $0.005 per send from the first send | Per send: one template to one recipient, all channels | One send covers all channels | `@trycourier/courier-react` `<CourierInbox />` | Real-time, Courier-hosted | Not stated |
| SuprSend | 10,000 notifications | Essentials $100, 50,000, then $0.002 each | Per notification, per channel | Yes | `@suprsend/react` (inbox on every plan) | Not checked | SuprSend branding shown |
| Build on SQLite | No vendor cost | n/a | n/a | n/a | Build it (shadcn/Radix already in repo) | Not included; poll or SSE | n/a |

## Knock

**Pricing.** Free: $0, up to 10,000 messages a month. Starter: $250 a month with 50,000 messages, then $0.005 each. Enterprise: custom. A message is "a single message delivered to a single user on a single channel"; an in-app message plus an email counts as two. Knock does not hard-cap the free tier and says it will contact you about billing if you go over. Stored user profiles are unlimited with no per-user fee. Free keeps Knock branding; Starter removes it. Log retention is 30 days on Free and Starter. [Knock pricing](https://knock.app/pricing)

**What you get.** Feeds are "a type of in-app channel that returns a per-user list of in-app messages". Knock handles badge counts and read, seen and archived tracking, and "the in-app API comes ready with websocket support, no infrastructure setup required". [In-app UI overview](https://docs.knock.app/in-app-ui/overview) The React package `@knocklabs/react` provides `NotificationIconButton` (bell with unread or unseen count), `NotificationFeedPopover` and `NotificationFeed`, plus hooks for a custom UI. [React overview](https://docs.knock.app/in-app-ui/react/overview)

**What it requires.**
- Workflows are defined in Knock and triggered from the server via `POST /v1/workflows/{workflow_key}/trigger`. [Triggering workflows](https://docs.knock.app/send-notifications/triggering-workflows/overview)
- Recipients "must be stored in Knock" before they can be notified. Inline identification in the trigger call does this in the same request; each recipient must be a user object with at least an `id`. [Identifying recipients](https://docs.knock.app/managing-recipients/identifying-recipients)
- The browser connects with a public API key and a user ID. Without enhanced security mode, "a request with your public key can act as any user". With it on, the server signs a per-user RS256 JWT with a Knock signing key (`signUserToken` in the Node SDK defaults to a 3,600-second expiry). [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- npm, 2026-11-17: `@knocklabs/react` 0.15.1, MIT, peer `react ^17 || ^18 || ^19`. `@knocklabs/node` 1.41.1, Apache-2.0.

**Lock-in.** Feed items, read state and workflow definitions live in Knock. The SDKs are open-source; the service is not. Knock's data export options were not checked.

## Novu

**Pricing (Cloud).** Free: $0, 10,000 workflow runs a month, up to 5 workflows, 24-hour activity feed retention. Pro: from $30 a month, 30,000+ runs, 7-day retention. Team: from $250 a month, 250,000+ runs, 90-day retention. Overage is $1.20 per 1,000 runs on Pro and Team. "A workflow run is one execution of a workflow": one run per subscriber, so a topic of 100 subscribers counts as 100 runs. Pricing covers runs "across all environments". Novu says it never stops or throttles notifications over the limit. "Subscribers are unlimited on paid plans"; the free-plan figure is not stated clearly. [Novu pricing](https://novu.co/pricing.md)

**What you get.** `<Inbox />` provides a bell, a real-time unread count, the list, mark as read synced to the backend in real time, and a Preferences component. Packages: `@novu/react` (React 18+, React 19 supported) and `@novu/js`. [Inbox overview](https://docs.novu.co/platform/inbox/overview)

**What it requires.**
- The browser renders `<Inbox />` with a public application identifier and a subscriber ID. A subscriber is created on first session if you pass a `subscriber` object. [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- For production, Novu recommends HMAC: the server signs each subscriber ID with HMAC-SHA256 and the secret key and passes it as `subscriberHash`. Without it, someone "could potentially guess another subscriber's `subscriberId`" and read their notifications. On the free plan the "Remove Novu branding" toggle is disabled, and branding shows in the Inbox UI. [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)
- npm, 2026-11-17: `@novu/react` 3.20.0, ISC, peer `react ^18 || ^19`. Server SDK: `@novu/api` 3.20.0.

**Self-hosting and lock-in.** The `novuhq/novu` repo has an MIT core (`LICENSE-MIT`) plus enterprise-licensed packages (`LICENSE-ENTERPRISE`, `EE-PACKAGES-LICENSE`). [GitHub repo root](https://github.com/novuhq/novu) The self-hosted community edition needs the Novu API, Worker and WS services, a dashboard, two Redis clusters (one with AOF for queues), MongoDB and S3-compatible storage; a single-VM setup is documented. Some cloud-only features "will not be available in a self-hosted environment", and the docs point to a comparison page that covers Inbox features among others. [Self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview) The paid Enterprise Self-Hosted tier adds SSO, RBAC, audit logs and branding removal. [Novu pricing](https://novu.co/pricing.md) Self-hosting would add MongoDB and Redis next to Cadence's one process and one SQLite file.

## MagicBell

**Pricing.** Builder: $0, 1,000 deliveries a month, 1 project, unlimited users; after that "each additional delivery will be charged per use" (no rate given for Builder). Startup: $249 a month, 50,000 deliveries, then $0.0025 each; 5 projects, $99 per extra project. Enterprise: custom, unlimited deliveries. Deliveries are counted per channel: one notification to 100 users in-app and 50 by email is 150 deliveries. [MagicBell pricing](https://www.magicbell.com/pricing)

**What you get.** `FloatingInbox` (a panel that opens from a bell icon), a standalone `Inbox`, and actions to view, mark as read, archive and delete. "MagicBell maintains a persistent connection to deliver notifications in real-time." [In-app channel](https://www.magicbell.com/docs/channels/in_app) `@magicbell/react` also has `InlineNotification`, `ToastContainer` and `UserPreferences`; `ContextProvider` needs a `token` prop holding a User JWT. [React library](https://www.magicbell.com/docs/libraries/magicbell-react)

**What it requires.** The server signs a User JWT with HS256 and the project Secret Key, with claims `user_email` and/or `user_external_id` plus `api_key`. The docs' examples set a one-year expiry. [User JWT](https://www.magicbell.com/docs/api/authentication/user) npm, 2026-11-17: `@magicbell/react` 1.14.0.

**Lock-in.** Notifications and read state are stored by MagicBell. No self-hosted option is listed on the pricing page.

## Courier

**Pricing.** Developer: free up to 10,000 sends a month; to go past that you add a card and move to Business. Business: $0.005 per send, pay as you go, including the first 10,000. Enterprise: custom, below $0.005 per send. A send is one template to one recipient, and a template delivering through several channels (in-app included) is still one send. Test-environment sends are billed like production ones. [Courier pricing](https://www.courier.com/pricing)

**What you get.** `<CourierInbox />` with unread counts and badges, read and archive actions, message buttons and infinite scroll. Messages "arrive in real time". The page does not mention a bell or popover component. [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)

**What it requires.** "Your backend generates a JWT with your Courier API key and passes it to the client"; the client calls `signIn({ userId, jwt })`. `@trycourier/courier-react` v9 needs React 18+. [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview) npm, 2026-11-17: 9.3.5, MIT.

## SuprSend

**Pricing.** Free: 10,000 notifications a month. Essentials: $100 a month, 50,000, then $2 per 1,000. Business: $250 a month, 50,000, then $5 per 1,000. A notification is "a message triggered to a single user or object on any downstream channel"; email, SMS and in-app to one user count as three. Going over Free does not stop sending. Inbox components (embeddable and headless) are on every plan; Free shows SuprSend branding in the in-app feed. User preferences need the Business plan. Log retention is 30 days on Free. [SuprSend pricing](https://www.suprsend.com/pricing)

npm, 2026-11-17: `@suprsend/react` 1.6.0, MIT. Its real-time transport and auth model were not checked.

## Not covered

Stream (GetStream) activity feeds, OneSignal, Engagespot and Firebase are left out. They are either general-purpose feed or push products, or less established in-app inbox vendors. They can be added if the grilling ticket wants them.

## Build on SQLite (baseline)

What already exists, from the repo on `main`:
- `app/db/index.ts` opens `data.db` with better-sqlite3 in WAL mode with foreign keys on. ADR 0006 says there is "one writer at a time" and one machine. A notifications table would be one more `sqliteTable` in `app/db/schema.ts`, next to `refunds`, `comments` and the others.
- `radix-ui`, shadcn, `lucide-react` (bell icon) and `sonner` are already dependencies, so a popover, badge and list need no new packages.

What React Router gives:
- Mark as read is an action. Page data "is already revalidated automatically after actions", via `useFetcher` or `<Form>`. [useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)
- Updating the unread count without a navigation: `useRevalidator` exists for revalidating on "`Window` focus or polling on an interval". [useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)
- Push: a resource route loader can return any `Response` [Resource routes](https://reactrouter.com/how-to/resource-routes), so a `text/event-stream` body is possible. The docs do not cover SSE.

A caveat for SSE under this server. `@react-router/serve` 8.3.0 calls `app.use(compression())` on its Express app (`dist/cli.js`, read from the published package). The `compression` README says it "does not work out of the box with server-sent events" because it buffers output, and needs `res.flush()`, which a React Router loader cannot reach. [expressjs/compression README](https://github.com/expressjs/compression#server-sent-events) This was not tested here. Polling on focus or on an interval avoids the issue.

What building does not give for free: real-time push, preference UI, cross-channel orchestration and delivery logs. The v1 scope on the map leaves these out.

## Points that apply to every hosted option

- **User sync.** Every vendor needs a user record on its side: Knock users (inline identify), Novu subscribers, MagicBell `user_external_id`/`user_email`, Courier `userId`. Each needs the server to sign a per-user token or hash so one user cannot read another's feed.
- **Where state lives.** Feed items and read state live with the vendor, not in `data.db`. The map's open questions (an item changing after the notification is sent, shared or per-admin read state for Platform Admins, retention) would be answered through each vendor's API and data model rather than in Drizzle. Each vendor's update and delete APIs were not checked.
- **Real-time and the one process.** With hosted options the browser holds its real-time connection to the vendor, so it adds no long-lived connections to the Cadence process.
- **Dependency.** Each adds a hosted runtime dependency for rendering the bell, alongside Postmark for email.
