# ProFusion GC Website — Setup Guide

You have three files:
- `index.html` — the website (design + chat UI)
- `api/chat.js` — the backend that holds your API key and runs the bot
- `vercel.json` — deploy settings

The chat only works once `api/chat.js` is deployed. Opening `index.html` by itself
shows the full site, but the bot will say "connection hiccup" because there's no
backend to talk to yet. That's expected until you deploy.

---

## Step 1 — Put the files on GitHub
1. Make a free account at github.com if you don't have one.
2. Create a new repository called `profusion-gc-site`.
3. Upload all three files, keeping `chat.js` inside a folder named `api`.

## Step 2 — Deploy on Vercel (free)
1. Go to vercel.com, sign in with GitHub.
2. Click **Add New → Project**, pick `profusion-gc-site`, click **Deploy**.
3. In ~30 seconds you get a live URL like `profusion-gc-site.vercel.app`.

## Step 3 — Add your API key (this is the important one)
1. In Vercel: your project → **Settings → Environment Variables**.
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your Anthropic key (from console.anthropic.com)
3. Save, then go to **Deployments → … → Redeploy** so it picks up the key.
4. Open your `.vercel.app` URL and test the chat. It should reply.

> The key lives only in Vercel's settings — never in the website code, so nobody
> can steal it by viewing your page source.

## Step 4 — Send leads into Airtable (optional but recommended)
1. In Make.com, create a scenario starting with a **Custom Webhook**. Copy its URL.
2. Add a second module: **Airtable → Create a Record** into your ProFusion CRM v2
   base. Map the incoming fields (name, phone, email, address, property_type,
   service, urgent, insurance_claim, scope, timeline, budget, summary).
3. Back in Vercel → Environment Variables, add:
   - Name: `LEAD_WEBHOOK_URL`
   - Value: the Make webhook URL
4. Redeploy. Now every completed chat drops a lead straight into Airtable.

## Step 5 — Point your domain at it
1. In Vercel: project → **Settings → Domains** → add `profusiongc.com` and `www.profusiongc.com`.
2. Vercel shows you the exact records to create. For this setup they'll be roughly:
   - `A` `@` → `76.76.21.21`
   - `CNAME` `www` → `cname.vercel-dns.com`
   (Use whatever Vercel actually shows you — don't guess.)
3. In Bluehost DNS: edit your two existing `A` records (currently `217.196.50.75`)
   to match. Leave your MX and TXT records alone so Google email keeps working.
4. Wait 10 min–2 hrs. Your site is live at profusiongc.com.

---

## Changing the bot's behavior later
Everything the bot knows and how it qualifies leads lives in the `SYSTEM_PROMPT`
at the top of `api/chat.js`. Edit that text, push to GitHub, and Vercel redeploys
automatically. No other code needs to change.
