# 📦 Deemona Finance Platform - Installation Guide

## Table of Contents

1. [Pre-Installation Checklist](#pre-installation-checklist)
2. [System Preparation](#system-preparation)
3. [Database Setup](#database-setup)
4. [Backend Installation](#backend-installation)
5. [Frontend Deployment](#frontend-deployment)
6. [SSL Configuration](#ssl-configuration)
7. [Post-Installation](#post-installation)
8. [Troubleshooting](#troubleshooting)

---

## 🔍 Pre-Installation Checklist

Before starting, ensure you have:

- [ ] Server with Ubuntu 22.04 LTS or CentOS 8+
- [ ] Root or sudo access
- [ ] Domain name pointing to server IP
- [ ] SSL certificate (or use Let's Encrypt)
- [ ] PostgreSQL 14+ installed
- [ ] Node.js 18+ installed
- [ ] Nginx or Apache installed
- [ ] Firewall configured (ports 80, 443, 3000)

---

## 🖥️ System Preparation

### Step 1: Update System
```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### Step 2: Install Node.js
```bash
# Install Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x
```

### Step 3: Install PostgreSQL
```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib -y

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify installation
sudo -u postgres psql --version
```

### Step 4: Install Nginx
```bash
# Ubuntu/Debian
sudo apt install nginx -y

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 🗄️ Database Setup

### Step 1: Create Database User
```bash
sudo -u postgres psql
```
```sql
-- Create user
CREATE USER deemona_user WITH PASSWORD 'YourSecurePassword123!';

-- Create database
CREATE DATABASE deemona_finance OWNER deemona_user;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE deemona_finance TO deemona_user;

-- Exit
\q
```

### Step 2: Import Schema
```bash
cd /path/to/deemona-finance-platform/backend

# Import schema
sudo -u postgres psql -d deemona_finance -f database/schema.sql

# Import seed data (optional - demo data)
sudo -u postgres psql -d deemona_finance -f database/seed_data.sql
```

### Step 3: Verify Database
```bash
sudo -u postgres psql -d deemona_finance
```
```sql
-- List tables
\dt

-- Check users table
SELECT * FROM users LIMIT 1;

-- Exit
\q
```

---

## 🔧 Backend Installation

### Step 1: Extract and Navigate
```bash
cd /opt
sudo unzip /path/to/deemona-finance-platform-v1.0.zip
sudo mv deemona-finance-platform-v1.0 deemona
cd deemona/backend
```

### Step 2: Install Dependencies
```bash
npm install --production
```

### Step 3: Configure Environment
```bash
# Copy example config
cp .env.example .env

# Edit configuration
nano .env
```

**Required .env Configuration:**
```env
# Server Configuration
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=deemona_finance
DB_USER=deemona_user
DB_PASSWORD=YourSecurePassword123!
DB_SSL=false

# Security
JWT_SECRET=generate_random_64_char_string_here
SESSION_SECRET=generate_random_64_char_string_here
BCRYPT_ROUNDS=12

# API Configuration
API_RATE_LIMIT=100
API_RATE_WINDOW=900000
CORS_ORIGIN=https://yourdomain.com

# WebSocket
WS_ENABLED=true
WS_HEARTBEAT_INTERVAL=30000

# File Upload
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=csv,xlsx,xls

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/deemona/app.log

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your_email_password
```

**Generate Secrets:**
```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Step 4: Create System Service
```bash
sudo nano /etc/systemd/system/deemona.service
```
```ini
[Unit]
Description=Deemona Finance Platform
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/deemona/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=deemona

[Install]
WantedBy=multi-user.target
```

### Step 5: Start Service
```bash
# Reload systemd
sudo systemctl daemon-reload

# Start service
sudo systemctl start deemona

# Enable on boot
sudo systemctl enable deemona

# Check status
sudo systemctl status deemona

# View logs
sudo journalctl -u deemona -f
```

---

## 🌐 Frontend Deployment

### Step 1: Copy Frontend Files
```bash
# Create web directory
sudo mkdir -p /var/www/deemona

# Copy files
sudo cp /opt/deemona/app/* /var/www/deemona/

# Set permissions
sudo chown -R www-data:www-data /var/www/deemona
sudo chmod -R 755 /var/www/deemona
```

### Step 2: Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/deemona
```
```nginx
# HTTP - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/ssl/certs/yourdomain.com.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Root Directory
    root /var/www/deemona;
    index index.html;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Static Files
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /v1/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket Support
    location /v1/stream {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # File Upload
    client_max_body_size 10M;

    # Access Logs
    access_log /var/log/nginx/deemona_access.log;
    error_log /var/log/nginx/deemona_error.log;
}
```

### Step 3: Enable Site
```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/deemona /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## 🔐 SSL Configuration

### Option 1: Let's Encrypt (Recommended)
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal is configured automatically
# Test renewal
sudo certbot renew --dry-run
```

### Option 2: Custom SSL Certificate
```bash
# Copy your certificate files
sudo cp yourdomain.com.crt /etc/ssl/certs/
sudo cp yourdomain.com.key /etc/ssl/private/

# Set permissions
sudo chmod 600 /etc/ssl/private/yourdomain.com.key
```

---

## ✅ Post-Installation

### Step 1: Change Default Passwords
```bash
# Login to admin panel
# https://yourdomain.com/admin_login.html

# Username: admin
# Password: deemona2024!

# IMMEDIATELY change password in Settings > Security
```

### Step 2: Configure Firewall
```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Check status
sudo ufw status
```

### Step 3: Create Backups
```bash
# Database backup script
sudo nano /opt/deemona/backup.sh
```
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/deemona"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
pg_dump -U deemona_user deemona_finance | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup uploaded files (if any)
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /var/www/deemona/uploads

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: $DATE"
```
```bash
# Make executable
sudo chmod +x /opt/deemona/backup.sh

# Add to cron (daily at 2 AM)
sudo crontab -e
0 2 * * * /opt/deemona/backup.sh >> /var/log/deemona/backup.log 2>&1
```

### Step 4: Monitoring Setup
```bash
# Install monitoring tools
sudo apt install htop iotop nethogs -y

# View system resources
htop

# Monitor application logs
sudo journalctl -u deemona -f

# Monitor Nginx logs
sudo tail -f /var/log/nginx/deemona_access.log
```

### Step 5: Test Installation
```bash
# Check all services
sudo systemctl status deemona
sudo systemctl status nginx
sudo systemctl status postgresql

# Test API endpoint
curl -k https://yourdomain.com/v1/health

# Expected response:
# {"status":"ok","timestamp":"2026-01-XX..."}
```

---

## 🐛 Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u deemona -n 50 --no-pager

# Common issues:
# 1. Port already in use
sudo lsof -i :3000

# 2. Database connection failed
sudo -u postgres psql -d deemona_finance -c "SELECT 1;"

# 3. Permissions issue
sudo chown -R www-data:www-data /opt/deemona
```

### Database Connection Errors
```bash
# Test connection
psql -h localhost -U deemona_user -d deemona_finance

# Check PostgreSQL status
sudo systemctl status postgresql

# View PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Nginx Errors
```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/deemona_error.log

# Restart Nginx
sudo systemctl restart nginx
```

### Performance Issues
```bash
# Check system resources
free -h
df -h
top

# Check PostgreSQL connections
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity;"

# Optimize PostgreSQL
sudo -u postgres psql deemona_finance
VACUUM ANALYZE;
```

---

## 📞 Support

If you encounter issues not covered here:

1. Check [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
2. Review [FAQ.md](support/FAQ.md)
3. Contact support@deemona.com

---

**Installation complete! 🎉**

Access your dashboard at: **https://yourdomain.com**

Default admin credentials:
- Username: `admin`
- Password: `deemona2024!` **(CHANGE IMMEDIATELY!)**