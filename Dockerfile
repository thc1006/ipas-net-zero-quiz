# Multi-stage Docker build for Vue 3 application
# Stage 1: Build the application
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with clean slate
RUN npm ci --only=production --no-audit --no-fund

# Copy source code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Build the application
RUN npm run build

# Remove development dependencies to reduce image size
RUN npm prune --production

# Stage 2: Production runtime with nginx
FROM nginx:1.25-alpine AS production

# Install security updates
RUN apk update && apk upgrade && apk add --no-cache \
    curl \
    && rm -rf /var/cache/apk/*

# Copy custom nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/default.conf /etc/nginx/conf.d/default.conf

# Copy built application from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy static assets with proper permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set security headers and configurations
RUN echo 'server_tokens off;' >> /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Add labels for better image management
LABEL maintainer="iPAS Net Zero Quiz Team" \
      description="iPAS Net Zero Quiz Application" \
      version="1.0.0" \
      org.opencontainers.image.title="iPAS Net Zero Quiz" \
      org.opencontainers.image.description="Vue 3 based quiz application for Taiwan iPAS net zero certification" \
      org.opencontainers.image.source="https://github.com/user/ipas-net-zero-quiz" \
      org.opencontainers.image.vendor="iPAS Quiz Team"

# Start nginx
CMD ["nginx", "-g", "daemon off;"]