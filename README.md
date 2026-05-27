# Suttonly Sweet — Website

Custom bakery website with Square invoice integration via Netlify Functions.

## Tech Stack
- Static HTML/CSS/JS frontend
- Netlify Functions (serverless) for Square API calls
- Square Invoices API — draft invoices created on order submission

## Order Flow
1. Customer submits order request form
2. Netlify function fires → creates Square customer (or finds existing) → creates Order → creates **draft invoice**
3. You review the draft in Square dashboard → update price → click **Send**
4. Customer receives Square payment email → pays online
5. Order confirmed

## Setup

### 1. GitHub
Create a new repo and push all these files.

### 2. Netlify
- Connect your GitHub repo to Netlify
- Set publish directory to `.` (root)
- Functions directory auto-detected from `netlify.toml`

### 3. Environment Variables
In Netlify → Site configuration → Environment variables, add:

| Variable | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | Your Square access token (from developer.squareup.com) |
| `SQUARE_LOCATION_ID` | Your Square location ID |
| `SQUARE_ENVIRONMENT` | `sandbox` for testing, `production` when live |

### 4. Square Setup
1. Go to [developer.squareup.com](https://developer.squareup.com)
2. Create an application (or use existing)
3. Get your **Access Token** and **Location ID** from the dashboard
4. Start with Sandbox to test, switch to Production when ready

### 5. Social Links
In `index.html`, replace both instances of `YOURUSERNAME` with your actual Instagram and Facebook handles.

### 6. Email Address
In `index.html` footer, update `hello@suttonlysweet.com` to your real email.

## File Structure
```
suttonlysweet/
├── index.html                  # Main site
├── netlify.toml                # Netlify config
├── package.json                # Dependencies
├── .gitignore
└── netlify/
    └── functions/
        └── submit-order.js     # Square invoice creation
```

## Testing
Use Square Sandbox credentials first. Submit a test order and check your Square Sandbox dashboard — you should see a draft invoice created with the customer's info.
