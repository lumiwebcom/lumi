# lumi ✨

A community app for your people: chats, spaces with rooms and lounges, moments, and calls. You get friends, DMs, group chats, servers, roles, invites, and voice, video and screen-share calls, all in real time.

## Quick start

Requires **Node.js 22.13 or newer** ([download](https://nodejs.org)).

On Windows, just double-click **Start Lumi**. Otherwise:

```bash
npm install
npm start
```

Open **http://localhost:3000**, sign up, then open a second browser (or a private window) and sign up as another user to try it out with yourself.

## What's inside

| Area | Features |
|---|---|
| **Accounts** | Email + password sign-up/login (bcrypt-hashed), Google sign-in, profiles with photo, banner, bio, status, profile color, username changes |
| **Friends** | Requests by username, accept/ignore/cancel, remove, block/unblock, online presence, "Active now" panel |
| **Messaging** | 1:1 DMs and group DMs (up to 10), real-time delivery, typing indicators, replies, edit (↑ to edit last), delete, emoji reactions, **double-click to ❤️**, pins, search, photo/video/file uploads (paste or drag & drop), markdown (`**bold**`, `*italic*`, `` `code` ``, code blocks, `> quotes`, `||spoilers||`), @mentions, unread badges, drafts saved per chat |
| **Calls** | Voice & video calls in DMs and group DMs with ringing (accept / accept with video / decline), voice channels in servers, screen sharing, mute/deafen, speaking indicators, call timer, double-click a tile to focus it |
| **Servers** | Create from templates, icon + banner + description, text & voice channels with topics, invite links (expiry & max uses), invite friends directly, leave, transfer ownership, delete |
| **Roles & moderation** | Custom roles with colors, 12 permissions, display separately in the member list, reorder hierarchy, assign/remove from members, kick, ban (with reason) and unban, nicknames. Enforced on the server, so members can't edit or assign roles at or above their own. |
| **Instagram touches** | Gradient story rings, **24-hour Stories** with progress bars and replies that land in DMs, chat bubbles that shift color with position, heart button to send ❤️, light and dark themes |
| **Notifications** | Desktop notifications for DMs and mentions, sounds (no audio files needed), unread counts in the tab title |
| **Mobile** | Responsive layout with a slide-out drawer |

## Enabling Google sign-in

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add your site URL, e.g. `http://localhost:3000` (and your real domain later).
3. Copy `.env.example` to `.env` and paste the Client ID into `GOOGLE_CLIENT_ID=`.
4. Restart the server. The "Continue with Google" button turns on automatically.

## Going live (so friends on other networks can join)

- **HTTPS is required** for microphone and camera access anywhere other than `localhost`. Put the app behind a reverse proxy with TLS (Caddy, nginx + Let's Encrypt), or deploy to a host that provides HTTPS (Render, Railway, Fly.io, a VPS…). Set `NODE_ENV=production`.
- **Add a TURN server** for reliable calls. Peer-to-peer WebRTC works for most home networks using the built-in STUN servers, but strict NATs need a relay. Run [coturn](https://github.com/coturn/coturn) or use a hosted TURN service, then set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` in `.env`.
- Data (SQLite database + uploads) lives in `./data`. Back it up, or point `DATA_DIR` at a persistent disk.
- If you sit behind a proxy, make sure WebSocket upgrades are forwarded (`/socket.io/`).

## How it works

```
server.js          Express REST API + Socket.IO (realtime events & WebRTC signaling) + SQLite
public/
  index.html
  styles.css       Instagram-inspired design system, light & dark
  js/core.js       helpers, icons, API client, state, router, menus/modals, markdown
  js/auth.js       login / sign-up / Google
  js/views.js      server rail, sidebars, friends home, chat, member list
  js/modals.js     create/join server, invites, server settings & roles, profiles, user settings, groups, stories
  js/call.js       WebRTC mesh calls (voice, video, screen share), ringing, speaking detection
  js/main.js       boot + realtime event handling
```

There's no build step: edit a file and refresh. Calls use a peer-to-peer mesh, which works well for small groups (roughly up to 6–8 people with video). Bigger rooms would need an SFU such as LiveKit or mediasoup.
