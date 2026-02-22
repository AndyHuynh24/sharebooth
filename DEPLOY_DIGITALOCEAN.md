# Deploy Sharebooth on DigitalOcean

## Step 1: Get $200 Free Credits

The $200 credit comes from your **hackathon's specific link**:

1. **Check your hackathon dashboard** (Devpost or registration platform) — look for a "Resources" or "Sponsors" tab for a DigitalOcean referral link or promo code
2. **Check the hackathon Discord/Slack** — sponsors usually post credit links in a `#sponsors` or `#digitalocean` channel
3. **Check your registration email** — credit links are sometimes in the welcome/confirmation email
4. **Ask at the DigitalOcean sponsor booth** (if in-person) or in the hackathon help channel

The link usually looks like:
```
https://try.digitalocean.com/[hackathon-name]
```

### Alternative Ways to Get Free Credits

| Method | Credit | How |
|--------|--------|-----|
| **GitHub Student Pack** | $200 | Go to education.github.com → verify `.edu` email → activate DigitalOcean |
| **DigitalOcean default trial** | $200 (60 days) | Sign up normally at digitalocean.com — applied automatically |

---

## Step 2: Sign Up for DigitalOcean

1. Go to **digitalocean.com** and click **Sign Up**
2. Sign up with your **GitHub account** (easiest since your code is on GitHub)
3. Apply the hackathon credit link or promo code
4. Add a payment method (credit card or PayPal) — the $200 credit covers everything, you won't be charged

---

## Step 3: Push Latest Code to GitHub

Make sure all your changes are committed and pushed:

```bash
git add public/client.js public/index.html public/style.css server.js
git commit -m "Add settings panel, photo swap, and real-time sync"
git push origin main
```

---

## Step 4: Create an App on DigitalOcean

1. Click **Create** (green button, top right) → **App Platform**
2. Choose **GitHub** as the source
3. Authorize DigitalOcean to access your GitHub — click **Authorize**
4. Select your repo: **AndyHuynh24/sharebooth**
5. Select branch: **main**
6. It auto-detects Node.js — you'll see:
   - **Build Command:** `npm install`
   - **Run Command:** `node server.js`
7. If it doesn't auto-detect, set those manually

---

## Step 5: Configure the App

On the settings screen:

- **Plan:** Choose **Basic** ($5/mo — covered by your $200 credit)
- **Instance size:** 1 container, 512MB RAM
- **Region:** Pick closest to your users (e.g., San Francisco or New York for US)
- **Environment variables:**
  - Key: `NODE_ENV` → Value: `production`
- **HTTP Port:** Set to `4000`

---

## Step 6: Deploy

1. Click **Create Resources** / **Deploy**
2. Wait ~2-3 minutes for build and deploy
3. You'll get a live URL like: `https://sharebooth-xxxxx.ondigitalocean.app`
4. Open it — your app is live worldwide!

---

## Step 7: Verify It Works

1. Open the URL on your phone + laptop
2. Create a session on one device
3. Join with the code on the other device
4. Snap photos, swap them, move them — verify real-time sync works across devices

---

## Tips for Winning "Best Use of DigitalOcean"

In your hackathon pitch, mention:

- "Deployed on **DigitalOcean App Platform** for reliable, scalable real-time hosting"
- "WebSocket connections handled through DigitalOcean's infrastructure"
- "Zero-config deployment from GitHub with automatic deploys on every push"

---

## Auto-Deploy (Bonus)

DigitalOcean App Platform auto-deploys when you push to `main`. Every `git push` triggers a new build automatically — no manual redeploy needed.
