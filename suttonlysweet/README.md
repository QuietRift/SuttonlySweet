# Suttonly Sweet 🎂
**suttonlysweet.com** — Bakery website with Square-powered order management

---

## What's in this repo

```
suttonlysweet/
├── public/
│   ├── index.html          ← Homepage
│   ├── order.html          ← Customer order request form
│   ├── dashboard.html      ← Owner order management dashboard
│   └── assets/
│       └── logo.png
├── netlify/
│   └── functions/
│       ├── submit-order.js     ← Customer submits → emails you
│       ├── get-menu.js         ← Pulls live menu from Square Catalog
│       ├── accept-order.js     ← You accept → Square invoice fires
│       ├── decline-order.js    ← You decline → emails customer
│       └── square-webhook.js   ← Square notifies you on payment
├── netlify.toml            ← Netlify config
├── package.json
├── .env.example            ← Copy to .env for local dev
└── .gitignore
```

---

## Setup Steps

### 1. Push to GitHub
- Create a new repo at github.com (name it `suttonlysweet`)
- Drag this entire folder into it, or:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOURUSERNAME/suttonlysweet.git
git push -u origin main
```

### 2. Deploy to Netlify
- Go to app.netlify.com → Add new site → Import from GitHub
- Select your repo
- Build settings are auto-detected from `netlify.toml`
- Click Deploy

### 3. Add Environment Variables in Netlify
Go to: **Site Settings → Environment Variables → Add variable**

| Key | Value | Where to get it |
|-----|-------|-----------------|
| `SQUARE_ACCESS_TOKEN` | Your token | developer.squareup.com → Your App → Credentials |
| `SQUARE_LOCATION_ID` | Your location ID | Square Dashboard → Account → Locations |
| `SQUARE_ENVIRONMENT` | `sandbox` (test) or `production` (live) | — |
| `RESEND_API_KEY` | Your Resend key | resend.com → API Keys |
| `OWNER_EMAIL` | you@suttonlysweet.com | Your email |
| `DASHBOARD_SECRET` | Any strong password | Make one up |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | From Square webhooks setup | See step 5 |

### 4. Connect Your Domain (suttonlysweet.com)
- In Netlify: **Domain Management → Add custom domain → suttonlysweet.com**
- Copy the DNS records Netlify gives you
- In Squarespace Domains: find suttonlysweet.com → DNS Settings → add those records
- **Do NOT touch your MX records** (keeps Gmail working)
- SSL auto-provisions within ~10 minutes

### 5. Set Up Square Webhook
So you get notified when a customer pays their invoice:
- Go to: developer.squareup.com → Your App → Webhooks
- Add endpoint: `https://suttonlysweet.com/api/square-webhook`
- Subscribe to events: `invoice.payment_made`, `invoice.payment_reminder_sent`
- Copy the Signature Key → add to Netlify env as `SQUARE_WEBHOOK_SIGNATURE_KEY`

### 6. Set Up Resend (Email)
- Sign up free at resend.com
- Add domain: suttonlysweet.com (they'll give you DNS records to add)
- Create API key → add to Netlify env as `RESEND_API_KEY`

### 7. Test in Sandbox Mode
- Keep `SQUARE_ENVIRONMENT=sandbox` while testing
- Use Square's test card numbers to verify invoices fire correctly
- Check your email for order notifications
- When everything works → change to `production`

---

## How It Works (Flow)

```
Customer visits suttonlysweet.com
    → Browses menu (pulled live from Square Catalog)
    → Fills out order form
    → Submits request (no payment yet)
        → Netlify Function fires
        → You get email notification with full order details
        → Customer gets confirmation screen

You review in /dashboard
    → Click "Accept & Invoice"
        → Square Customer created/found
        → Square Order created
        → Square Invoice generated & emailed to customer
        → You get confirmation email
    → OR click "Decline"
        → Customer gets polite decline email with link to try another date

Customer pays invoice
    → Square webhook fires
    → You get "Payment Received" email
    → Order appears in your Square daily wrap-up report ✅
```

---

## APIs Used

| API | Purpose |
|-----|---------|
| Square Catalog API | Pull live menu items |
| Square Customers API | Create/find customer records |
| Square Orders API | Create order in your POS |
| Square Invoices API | Generate & send payment invoice |
| Square Webhooks | Payment confirmation notifications |
| Resend | Email notifications to you and customers |

**One Square Developer account covers all Square APIs.**

---

## Going Live Checklist

- [ ] GitHub repo created and code pushed
- [ ] Netlify site deployed
- [ ] All environment variables added in Netlify
- [ ] Domain connected (suttonlysweet.com → Netlify)
- [ ] Gmail still working after DNS change
- [ ] Resend domain verified
- [ ] Square webhook endpoint configured
- [ ] Tested full flow in sandbox mode
- [ ] `SQUARE_ENVIRONMENT` changed to `production`
- [ ] First real order placed 🎂
