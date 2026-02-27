# Sharebooth

A real-time collaborative photobooth app. Multiple users join a session, snap photos, and compose them together on a shared canvas with decorations, layouts, and background effects.

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:4000` in your browser.
4. Click **Create Session** in one window, copy the code, and join from another window using **Join with Code**.

## Deploy to AWS (EC2)

### First-Time Setup

1. Launch an EC2 instance (Amazon Linux 2 or Ubuntu).
2. SSH in and install Node.js:
   ```bash
   # Amazon Linux 2
   curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
   sudo yum install -y nodejs git

   # Ubuntu
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs git
   ```
3. Clone the repo and install:
   ```bash
   git clone https://github.com/AndyHuynh24/sharebooth.git
   cd sharebooth
   npm install
   ```
4. Install pm2 to keep the app running:
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name sharebooth
   pm2 startup   # follow the printed command to enable auto-start on reboot
   pm2 save
   ```
5. Make sure your EC2 security group allows inbound traffic on port 4000 (or 80/443 if using a reverse proxy).

### Updating the App

1. SSH into the EC2 instance:
   ```bash
   ssh -i ~/Downloads/sharebooth-key.pem ec2-user@YOUR_EC2_IP
   ```
   > Replace `YOUR_EC2_IP` with your server's public IP (find it in AWS Console > EC2 > Instances).
   > Use `ubuntu@` instead of `ec2-user@` if running Ubuntu.

   If you get a permissions error on the key file:
   ```bash
   chmod 400 ~/Downloads/sharebooth-key.pem
   ```

2. Pull the latest code and restart:
   ```bash
   cd ~/sharebooth
   git pull origin main
   npm install          # only needed if dependencies changed
   pm2 restart sharebooth
   ```

3. Verify it's running:
   ```bash
   pm2 list
   pm2 logs sharebooth --lines 20
   ```

### Optional: Nginx Reverse Proxy (serve on port 80/443)

```bash
sudo yum install -y nginx   # or: sudo apt install -y nginx
```

Add to `/etc/nginx/conf.d/sharebooth.conf`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then: `sudo systemctl restart nginx`

## Files

- `server.js` — Node + Express + Socket.IO server
- `public/client.js` — Client-side app logic (camera, canvas, decorations, socket sync)
- `public/index.html` — Single-page app HTML
- `public/style.css` — All styles
- `assets/background/` — Background images for the photobooth frame
