# Deployment Guide

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Build Process](#build-process)
4. [Deployment Options](#deployment-options)
5. [Environment Configuration](#environment-configuration)
6. [Performance Optimization](#performance-optimization)
7. [Security Considerations](#security-considerations)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)
9. [Rollback Procedures](#rollback-procedures)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This guide provides comprehensive instructions for deploying the iPAS Net Zero Quiz Application to various hosting platforms. The application is built as a static Single Page Application (SPA) that can be deployed to any static hosting service.

### Deployment Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   GitHub     │────→│   CI/CD      │────→│   CDN/Host   │
│   Repository │     │   Pipeline   │     │   Service    │
└──────────────┘     └──────────────┘     └──────────────┘
                            ↓
                    ┌──────────────┐
                    │   Testing    │
                    │   & Build    │
                    └──────────────┘
```

---

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18.0+ | Build environment |
| npm | 9.0+ | Package management |
| Git | 2.30+ | Version control |

### Access Requirements

- Repository access (read/write)
- Deployment platform credentials
- Domain management access (if custom domain)
- SSL certificate (provided by platform or custom)

---

## Build Process

### 1. Local Build

```bash
# Install dependencies
npm ci

# Run tests
npm run test

# Build for production
npm run build

# Preview production build
npm run preview
```

### 2. Build Output

After building, the `dist/` directory contains:

```
dist/
├── assets/
│   ├── index-[hash].js       # Main application bundle
│   ├── index-[hash].css      # Compiled CSS
│   └── vendor-[hash].js      # Vendor dependencies
├── favicon.svg                # Favicon
└── index.html                 # Entry HTML file
```

### 3. Build Configuration

#### Vite Configuration (`vite.config.js`)

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  base: '/', // Change for subdirectory deployment
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false, // Set to true for debugging
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['vue'],
          'quiz': ['./src/composables/useQuiz.js']
        }
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  },
  optimizeDeps: {
    include: ['vue']
  }
})
```

---

## Deployment Options

### Option 1: Netlify

#### Automatic Deployment

1. **Connect Repository**
   ```
   1. Log in to Netlify
   2. Click "New site from Git"
   3. Choose GitHub/GitLab/Bitbucket
   4. Select repository
   ```

2. **Configure Build Settings**
   ```
   Build command: npm run build
   Publish directory: dist
   Node version: 18
   ```

3. **Environment Variables**
   ```
   VITE_APP_TITLE=iPAS Net Zero Quiz
   VITE_GA_ID=UA-XXXXXXXXX-X
   ```

#### Manual Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build project
npm run build

# Deploy to Netlify
netlify deploy --prod --dir=dist
```

#### `netlify.toml` Configuration

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

### Option 2: Vercel

#### Automatic Deployment

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Deploy**
   ```bash
   vercel --prod
   ```

#### `vercel.json` Configuration

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vue",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### Option 3: GitHub Pages

#### Setup

1. **Install gh-pages**
   ```bash
   npm install --save-dev gh-pages
   ```

2. **Add Deploy Script**
   ```json
   // package.json
   {
     "scripts": {
       "deploy": "npm run build && gh-pages -d dist"
     }
   }
   ```

3. **Configure Base URL**
   ```javascript
   // vite.config.js
   export default defineConfig({
     base: '/ipas-net-zero-quiz/', // Repository name
     // ... other config
   })
   ```

4. **Deploy**
   ```bash
   npm run deploy
   ```

#### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
        env:
          VITE_GA_ID: ${{ secrets.VITE_GA_ID }}
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### Option 4: AWS S3 + CloudFront

#### S3 Bucket Setup

```bash
# Create S3 bucket
aws s3 mb s3://ipas-quiz-app

# Configure for static hosting
aws s3 website s3://ipas-quiz-app \
  --index-document index.html \
  --error-document index.html

# Set bucket policy
aws s3api put-bucket-policy \
  --bucket ipas-quiz-app \
  --policy file://bucket-policy.json
```

#### Bucket Policy (`bucket-policy.json`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::ipas-quiz-app/*"
    }
  ]
}
```

#### CloudFront Configuration

```bash
# Create CloudFront distribution
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json
```

#### Deploy Script

```bash
#!/bin/bash
# deploy-aws.sh

# Build
npm run build

# Sync to S3
aws s3 sync dist/ s3://ipas-quiz-app \
  --delete \
  --cache-control "public, max-age=31536000" \
  --exclude "index.html" \
  --exclude "*.json"

# Upload index.html with no-cache
aws s3 cp dist/index.html s3://ipas-quiz-app/ \
  --cache-control "no-cache, no-store, must-revalidate"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id EXXXXXXXXXX \
  --paths "/*"
```

### Option 5: Docker Container

#### Dockerfile

```dockerfile
# Build stage
FROM node:18-alpine as build-stage

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine as production-stage

# Copy built files
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

#### Nginx Configuration (`nginx.conf`)

```nginx
user nginx;
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/xml+rss 
               application/json application/x-font-ttf 
               font/opentype image/svg+xml image/x-icon;

    server {
        listen 80;
        server_name localhost;
        root /usr/share/nginx/html;
        index index.html;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;

        # Cache static assets
        location /assets/ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # Don't cache index.html
        location / {
            try_files $uri $uri/ /index.html;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }

        # Health check endpoint
        location /health {
            access_log off;
            return 200 "OK";
        }
    }
}
```

#### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  quiz-app:
    build: .
    ports:
      - "80:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

#### Build and Run

```bash
# Build Docker image
docker build -t ipas-quiz-app .

# Run container
docker run -d -p 80:80 --name quiz-app ipas-quiz-app

# Or use docker-compose
docker-compose up -d
```

---

## Environment Configuration

### Environment Variables

#### Development (`.env.development`)

```env
VITE_APP_TITLE=iPAS Quiz (Dev)
VITE_API_BASE_URL=http://localhost:3000
VITE_DEBUG_MODE=true
VITE_ENABLE_ANALYTICS=false
```

#### Staging (`.env.staging`)

```env
VITE_APP_TITLE=iPAS Quiz (Staging)
VITE_API_BASE_URL=https://staging-api.example.com
VITE_DEBUG_MODE=true
VITE_ENABLE_ANALYTICS=true
VITE_GA_ID=UA-STAGING-ID
```

#### Production (`.env.production`)

```env
VITE_APP_TITLE=iPAS Net Zero Quiz
VITE_API_BASE_URL=https://api.example.com
VITE_DEBUG_MODE=false
VITE_ENABLE_ANALYTICS=true
VITE_GA_ID=UA-PRODUCTION-ID
VITE_SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

### Build-time Configuration

```javascript
// src/config/index.js
const config = {
  appTitle: import.meta.env.VITE_APP_TITLE || 'iPAS Quiz',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  debugMode: import.meta.env.VITE_DEBUG_MODE === 'true',
  analytics: {
    enabled: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
    gaId: import.meta.env.VITE_GA_ID
  },
  sentry: {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE
  }
}

export default config
```

---

## Performance Optimization

### 1. Asset Optimization

#### Image Optimization

```bash
# Install image optimization tools
npm install --save-dev imagemin imagemin-pngquant imagemin-mozjpeg

# Optimize images script
node scripts/optimize-images.js
```

#### Bundle Splitting

```javascript
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor chunks
          if (id.includes('node_modules')) {
            if (id.includes('vue')) {
              return 'vue'
            }
            return 'vendor'
          }
          // Feature chunks
          if (id.includes('composables')) {
            return 'composables'
          }
          if (id.includes('components')) {
            return 'components'
          }
        }
      }
    }
  }
})
```

### 2. Caching Strategy

#### Service Worker

```javascript
// public/service-worker.js
const CACHE_NAME = 'ipas-quiz-v1'
const urlsToCache = [
  '/',
  '/index.html',
  '/assets/main.css',
  '/assets/main.js'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  )
})

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  )
})
```

### 3. CDN Configuration

#### CloudFlare Settings

```
Page Rules:
- /*: Cache Level: Standard
- /assets/*: Cache Level: Cache Everything, Edge Cache TTL: 1 month
- /index.html: Cache Level: Bypass

Performance:
- Auto Minify: JavaScript, CSS, HTML
- Brotli: On
- HTTP/2: On
- HTTP/3 (with QUIC): On
```

### 4. Preloading and Prefetching

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <!-- Preconnect to external domains -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="dns-prefetch" href="https://www.google-analytics.com">
  
  <!-- Preload critical assets -->
  <link rel="preload" href="/assets/main.css" as="style">
  <link rel="preload" href="/assets/main.js" as="script">
  
  <!-- Prefetch next page resources -->
  <link rel="prefetch" href="/assets/quiz.js">
</head>
</html>
```

---

## Security Considerations

### 1. Headers Configuration

#### Security Headers

```nginx
# nginx.conf
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

### 2. Content Security Policy

```html
<!-- index.html -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.google-analytics.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' https://www.google-analytics.com;
">
```

### 3. HTTPS Configuration

#### Let's Encrypt SSL

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d example.com -d www.example.com

# Auto-renewal
sudo certbot renew --dry-run
```

### 4. Environment Secrets

```yaml
# GitHub Actions secrets
- VITE_API_KEY
- VITE_GA_ID
- DEPLOY_TOKEN
- SENTRY_DSN
```

---

## Monitoring and Maintenance

### 1. Application Monitoring

#### Google Analytics

```javascript
// src/utils/analytics.js
export function initAnalytics() {
  if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
    window.dataLayer = window.dataLayer || []
    function gtag() { dataLayer.push(arguments) }
    gtag('js', new Date())
    gtag('config', import.meta.env.VITE_GA_ID)
  }
}
```

#### Sentry Error Tracking

```javascript
// src/main.js
import * as Sentry from '@sentry/vue'

if (import.meta.env.PROD) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      new Sentry.BrowserTracing(),
      new Sentry.Replay()
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}
```

### 2. Health Checks

#### Uptime Monitoring

```javascript
// public/health.json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-08-21T10:00:00Z"
}
```

#### Status Page

```html
<!-- public/status.html -->
<!DOCTYPE html>
<html>
<head>
  <title>System Status</title>
</head>
<body>
  <h1>iPAS Quiz System Status</h1>
  <div id="status">Checking...</div>
  <script>
    fetch('/health.json')
      .then(res => res.json())
      .then(data => {
        document.getElementById('status').textContent = 
          `Status: ${data.status} | Version: ${data.version}`
      })
      .catch(() => {
        document.getElementById('status').textContent = 'Status: Error'
      })
  </script>
</body>
</html>
```

### 3. Backup Strategy

```bash
#!/bin/bash
# backup.sh

# Variables
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/var/www/quiz-app"

# Create backup
tar -czf $BACKUP_DIR/quiz-app-$DATE.tar.gz $APP_DIR

# Keep only last 30 days of backups
find $BACKUP_DIR -name "quiz-app-*.tar.gz" -mtime +30 -delete

# Upload to S3
aws s3 cp $BACKUP_DIR/quiz-app-$DATE.tar.gz s3://backup-bucket/
```

---

## Rollback Procedures

### 1. Quick Rollback

```bash
#!/bin/bash
# rollback.sh

# Get previous version
PREVIOUS_VERSION=$(git tag | sort -V | tail -2 | head -1)

# Checkout previous version
git checkout $PREVIOUS_VERSION

# Rebuild and deploy
npm ci
npm run build
npm run deploy
```

### 2. Blue-Green Deployment

```nginx
# nginx.conf for blue-green deployment
upstream quiz_app {
    server blue.example.com weight=100;  # Current version
    server green.example.com weight=0;    # New version
}

server {
    location / {
        proxy_pass http://quiz_app;
    }
}
```

### 3. Feature Flags

```javascript
// src/utils/featureFlags.js
const features = {
  newQuizEngine: import.meta.env.VITE_FEATURE_NEW_ENGINE === 'true',
  darkMode: import.meta.env.VITE_FEATURE_DARK_MODE === 'true',
  analytics: import.meta.env.VITE_FEATURE_ANALYTICS === 'true'
}

export function isFeatureEnabled(feature) {
  return features[feature] || false
}
```

---

## Troubleshooting

### Common Deployment Issues

#### 1. Build Failures

```bash
# Clear cache and rebuild
rm -rf node_modules dist
npm cache clean --force
npm ci
npm run build
```

#### 2. 404 Errors on Routes

```nginx
# Add to nginx.conf
location / {
    try_files $uri $uri/ /index.html;
}
```

#### 3. CORS Issues

```nginx
# Add CORS headers
add_header Access-Control-Allow-Origin "*";
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
add_header Access-Control-Allow-Headers "Content-Type";
```

#### 4. Performance Issues

```bash
# Analyze bundle size
npm run build -- --report

# Check for large dependencies
npm list --depth=0

# Optimize build
npm run build -- --minify terser
```

### Deployment Checklist

#### Pre-deployment

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Environment variables configured
- [ ] Backup created
- [ ] Deployment notes documented

#### During Deployment

- [ ] Monitor deployment logs
- [ ] Check build output
- [ ] Verify asset uploads
- [ ] Test critical paths

#### Post-deployment

- [ ] Verify application loads
- [ ] Test core functionality
- [ ] Check error tracking
- [ ] Monitor performance metrics
- [ ] Update status page

### Emergency Contacts

| Role | Contact | When to Contact |
|------|---------|-----------------|
| DevOps Lead | devops@example.com | Deployment failures |
| Backend Team | backend@example.com | API issues |
| Security Team | security@example.com | Security incidents |
| On-call Engineer | +886-XXX-XXX | Critical outages |

---

## Appendix

### Useful Scripts

#### Health Check Script

```bash
#!/bin/bash
# health-check.sh

URL="https://quiz.example.com/health"
EXPECTED="OK"

response=$(curl -s $URL)

if [ "$response" = "$EXPECTED" ]; then
    echo "Health check passed"
    exit 0
else
    echo "Health check failed"
    exit 1
fi
```

#### Deployment Notification

```bash
#!/bin/bash
# notify-deployment.sh

VERSION=$(git describe --tags)
ENVIRONMENT=$1
WEBHOOK_URL="https://hooks.slack.com/services/XXX"

curl -X POST $WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d "{
    \"text\": \"Deployment Complete\",
    \"attachments\": [{
      \"color\": \"good\",
      \"fields\": [
        {\"title\": \"Version\", \"value\": \"$VERSION\"},
        {\"title\": \"Environment\", \"value\": \"$ENVIRONMENT\"},
        {\"title\": \"Time\", \"value\": \"$(date)\"}
      ]
    }]
  }"
```

---

*Last Updated: 2025-08-21*

*For deployment support, contact the DevOps team.*