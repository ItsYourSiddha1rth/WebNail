# WebNail

Turn a screenshot or a link into code. Sign in, get 10 free generations,
upgrade to $5.99/mo for unlimited (and an API key). Generation runs on a
self-hosted Ollama model (`llava:13b`) — no OpenAI/Anthropic API cost.

Built by **Siddharth Pathak** — Founder & Developer.

## Contents

- `website/index.html` — the whole site. Single file: hero with the WebGL
  ink background, sign-in/sign-up, an upload-screenshot / paste-a-link
  generation panel, pricing, and a founder section. Depends on
  `website/js/auth.js` (Supabase) and `website/js/generate.js` (calls your
  Render server).
- `server/` — the generation API. Express + Ollama in one Docker container,
  deployed to Render. See `server/src/index.js` for routes.
- `supabase/migrations/001_init.sql` — the full DB schema: profiles, usage
  quota, RLS policies, the `record_generation` / `ensure_api_key` RPCs.
- `supabase/functions/` — two Edge Functions for Stripe: creating a
  Checkout session, and the webhook that flips an account to unlimited.
- `Dockerfile` — builds the Render service (Ollama + Node API together).

## Setup, in order

### 1. Supabase (auth + database)

1. Create a project at supabase.com.
2. Open the SQL editor, paste in `supabase/migrations/001_init.sql`, run it.
   This creates `profiles`, `generations`, RLS policies, and two RPCs.
3. **Auth → Providers**: email/password is on by default. To enable Google
   sign-in, turn on the Google provider and add your OAuth client ID/secret.
4. **Auth → URL Configuration**: add your site's URL (and
   `http://localhost:8080` or whatever you use for local testing) to the
   allowed redirect URLs.
5. **Project Settings → API**: copy the **Project URL** and **anon public
   key**. Open `website/js/auth.js` and fill in `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` near the top of the file.

### 2. Stripe (the $5.99/mo unlimited plan)

1. In the Stripe dashboard, create a **Product** ("WebNail Unlimited") with
   a **recurring price of $5.99/month**. Copy its price ID (`price_...`).
2. Install the Supabase CLI, then from the project root:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
3. Set secrets for both functions:
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   supabase secrets set STRIPE_PRICE_ID=price_...
   supabase secrets set SITE_URL=https://your-domain.com
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` are
   auto-injected by Supabase — you don't set those.)
4. In the Stripe dashboard, add a webhook endpoint pointing at
   `https://YOUR-PROJECT-REF.functions.supabase.co/stripe-webhook`,
   listening for `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy
   its signing secret into `STRIPE_WEBHOOK_SECRET` above.

### 3. Render (the generation server — Ollama + API)

1. Push this repo to GitHub/GitLab.
2. In Render: **New → Web Service**, connect the repo, choose **Docker** as
   the environment (it will find the root `Dockerfile` automatically).
3. Pick an instance size with **at least 8GB RAM** — `llava:13b` needs it,
   and Render has no GPU tier, so this runs on CPU (expect roughly
   1–3 minutes per generation; the server handles this as a background job
   so requests don't time out, see `server/src/jobs.js`).
4. Set environment variables on the Render service:
   ```
   SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   (Project Settings → API — keep secret)
   ALLOWED_ORIGINS=https://your-domain.com
   ```
5. Deploy. First build will take a while — it pulls `llava:13b` (several GB)
   during the Docker build so it's baked into the image.
6. Once live, check `https://your-service.onrender.com/api/health` — it
   should report `{"ok": true, "ollama": {"ok": true, "modelPulled": true}}`.

### 4. Wire the website to your Render service

Open `website/js/generate.js` and set `API_BASE` to your Render service URL,
e.g. `https://webnail-server.onrender.com`.

### 5. Host the website

`website/index.html` is a single static file (with `website/js/` and
`website/assets/` alongside it) — deploy the `website/` folder to Netlify,
Vercel, GitHub Pages, or Render's static-site hosting. Make sure the URL you
deploy to matches what you put in Supabase's allowed redirect URLs and in
`ALLOWED_ORIGINS` on the server.

## How the pieces talk to each other

```
Browser (website/index.html)
  ├─ Supabase JS  → Supabase Auth + Postgres (sign in, quota, profile)
  ├─ Stripe redirect → Supabase Edge Function → Stripe Checkout
  └─ fetch(API_BASE) → Render server
                          ├─ verifies caller (Supabase JWT or API key)
                          ├─ checks + burns quota (record_generation RPC)
                          ├─ runs Ollama (llava:13b) locally in the container
                          └─ returns generated code
```

Stripe webhook → Supabase Edge Function → flips `profiles.is_unlimited` to
true, which the server checks on every request and the client reflects in
the UI (usage badge, upgrade button, API key panel).

## Local development

- Website: `cd website && python3 -m http.server 8080`, then open
  `http://localhost:8080`. Add that URL to Supabase's allowed redirect URLs.
- Server: needs Ollama installed locally (`ollama serve`, then
  `ollama pull llava:13b`) plus `cd server && npm install && npm run dev`.
  Set the same env vars as the Render service, plus `OLLAMA_URL` if it's
  not on the default `http://127.0.0.1:11434`.

## Notes on cost/performance

`llava:13b` on CPU is slow — this trades speed for running the whole stack
on infrastructure you control, with no per-call API fees to a hosted vision
model provider. If quality or latency becomes a problem, the model is a
single env var (`WEBNAIL_MODEL` in the Dockerfile) — swapping to
`llava:7b` (faster, less accurate) or a GPU-backed host (Render doesn't
offer GPUs; you'd need a different provider) are both drop-in changes to
`server/src/ollama.js`.
