# iPAS Net Zero Quiz - Production Deployment Guide

## 🚀 Deployment Overview

This project is now configured with a comprehensive production deployment setup including:

- **Optimized Vite Configuration** with Chinese font optimization
- **CI/CD Pipelines** using GitHub Actions
- **Docker Containerization** with multi-stage builds
- **Multiple Deployment Targets** (Vercel, Netlify, Docker)
- **PWA Support** for offline functionality
- **Performance Monitoring** with Lighthouse and Core Web Vitals
- **Error Tracking** with Sentry integration
- **Security Headers** and optimizations

## 📁 Added Configuration Files

### Build & Development
- `vite.config.js` - Enhanced with PWA, monitoring, and Chinese font optimization
- `.env` / `.env.production` - Environment variables configuration
- `lighthouserc.json` - Performance monitoring configuration

### CI/CD
- `.github/workflows/ci.yml` - Continuous Integration workflow
- `.github/workflows/deploy.yml` - Comprehensive deployment workflow
- `scripts/deploy.sh` - Multi-platform deployment script

### Docker
- `Dockerfile` - Multi-stage production build
- `docker-compose.yml` - Local development and production containers
- `docker/nginx.conf` - Optimized nginx configuration
- `docker/default.conf` - SPA routing and security headers

### Platform Deployment
- `vercel.json` - Vercel deployment configuration
- `netlify.toml` - Netlify deployment with plugins
- `public/robots.txt` - SEO optimization
- `public/manifest.webmanifest` - PWA manifest

### Monitoring
- `src/utils/monitoring.js` - Comprehensive monitoring service
- Performance tracking, error reporting, analytics integration

## 🛠 Available Commands

### Development
```bash
npm run dev              # Start development server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
npm run type-check       # TypeScript checking
```

### Testing
```bash
npm test                 # Run tests
npm run test:coverage    # Run with coverage
npm run test:watch       # Watch mode
```

### Deployment
```bash
npm run deploy                # Deploy using default script
npm run deploy:vercel         # Deploy to Vercel
npm run deploy:netlify        # Deploy to Netlify
npm run deploy:docker         # Build Docker image
./scripts/deploy.sh --help    # Show deployment options
```

### Analysis
```bash
npm run build:analyze    # Bundle size analysis
npm run lighthouse       # Performance audit
npm run serve           # Serve built files locally
```

## 🌍 Deployment Platforms

### 1. Vercel Deployment

**Setup:**
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard:
   ```
   VITE_ENABLE_ANALYTICS=true
   VITE_SENTRY_DSN=your_sentry_dsn
   VITE_GA_TRACKING_ID=your_ga_id
   ```

**Deploy:**
```bash
npm run deploy:vercel
```

### 2. Netlify Deployment

**Setup:**
1. Connect your GitHub repository to Netlify
2. Set environment variables in Netlify dashboard
3. Install build plugins (optional)

**Deploy:**
```bash
npm run deploy:netlify
```

### 3. Docker Deployment

**Build and run locally:**
```bash
docker-compose up --build
```

**Production deployment:**
```bash
docker build -t ipas-quiz:latest .
docker run -p 80:80 ipas-quiz:latest
```

## 🔐 Environment Variables

### Required for Production
```bash
VITE_APP_TITLE="iPAS Net Zero Quiz"
VITE_ENABLE_ANALYTICS=true
VITE_BUILD_MODE=production
```

### Optional Monitoring
```bash
VITE_SENTRY_DSN=https://your-sentry-dsn
VITE_GA_TRACKING_ID=G-XXXXXXXXXX
VITE_API_URL=https://api.example.com
```

### GitHub Secrets (for CI/CD)
```bash
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_org_id  
VERCEL_PROJECT_ID=your_project_id
NETLIFY_AUTH_TOKEN=your_netlify_token
NETLIFY_SITE_ID=your_site_id
GITHUB_TOKEN=automatic
```

## 📊 Performance Optimizations

### Bundle Optimization
- **Code Splitting**: Vendor and utility chunks separated
- **Chinese Font Optimization**: Optimized loading for Chinese typography
- **Asset Optimization**: Images, fonts, and media properly cached
- **Tree Shaking**: Unused code automatically removed

### PWA Features
- **Service Worker**: Automatic caching and offline support
- **Web App Manifest**: Installable app experience
- **Cache Strategy**: Optimized for Chinese fonts and assets
- **Background Sync**: Offline form submissions (when applicable)

### Security
- **CSP Headers**: Content Security Policy configured
- **Security Headers**: XSS, clickjacking, and MIME-type protection
- **HTTPS Redirect**: Automatic HTTPS enforcement
- **Rate Limiting**: API endpoint protection (nginx)

## 🔍 Monitoring & Analytics

### Core Web Vitals
Automatic tracking of:
- **FCP** (First Contentful Paint)
- **LCP** (Largest Contentful Paint)  
- **CLS** (Cumulative Layout Shift)
- **FID** (First Input Delay)
- **TTFB** (Time To First Byte)

### Error Tracking
- **Sentry Integration**: Production error monitoring
- **Custom Error Tracking**: Application-specific error handling
- **Performance Monitoring**: Slow operations detection

### Quiz Analytics
- **Completion Rates**: Track user engagement
- **Question Performance**: Identify difficult questions
- **User Journey**: Track user flow through quiz
- **Performance Metrics**: Load times and interactions

## 🚨 Deployment Checklist

Before deploying to production:

- [ ] Environment variables configured
- [ ] Sentry DSN configured (if using error tracking)
- [ ] Google Analytics ID set (if using analytics)
- [ ] PWA icons generated and placed in `/public/icons/`
- [ ] Screenshots for PWA added to `/public/screenshots/`
- [ ] Domain configured in platform settings
- [ ] SSL certificate configured (automatic on Vercel/Netlify)
- [ ] Performance budgets reviewed
- [ ] Security headers tested
- [ ] Mobile responsiveness verified
- [ ] Chinese font loading tested
- [ ] Offline functionality tested

## 📈 Performance Targets

Based on Lighthouse configuration:

- **Performance**: ≥ 80
- **Accessibility**: ≥ 90  
- **Best Practices**: ≥ 90
- **SEO**: ≥ 80
- **PWA**: ≥ 80

### Core Web Vitals Targets:
- **FCP**: < 2.0s
- **LCP**: < 2.5s
- **CLS**: < 0.1
- **FID**: < 100ms

## 🔧 Troubleshooting

### Common Issues

**Build fails on CI/CD:**
- Check Node.js version (requires 18+)
- Verify all dependencies are in package.json
- Check environment variables

**PWA not working:**
- Ensure HTTPS is enabled
- Check manifest.json is accessible
- Verify service worker registration

**Chinese fonts not loading:**
- Check font URLs in CSS
- Verify CORS headers for font files
- Test font preloading strategy

**Performance issues:**
- Run bundle analysis: `npm run build:analyze`
- Check Lighthouse report: `npm run lighthouse`
- Review network requests in DevTools

### Support

For deployment issues:
1. Check GitHub Actions logs
2. Review platform-specific logs (Vercel/Netlify)
3. Test locally with `npm run preview`
4. Check browser console for errors

## 🎯 Next Steps

After successful deployment:

1. **Set up monitoring alerts** in Sentry dashboard
2. **Configure Google Analytics goals** for quiz completion
3. **Set up uptime monitoring** (UptimeRobot, Pingdom)
4. **Enable lighthouse CI** for continuous performance monitoring
5. **Configure CDN** for global content delivery (if needed)
6. **Set up backup strategy** for user data
7. **Plan scaling strategy** based on usage metrics

---

**Deployment completed successfully!** 🎉

Your iPAS Net Zero Quiz application is now production-ready with enterprise-grade deployment, monitoring, and performance optimization.