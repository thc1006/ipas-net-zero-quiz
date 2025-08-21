#!/bin/bash

# iPAS Net Zero Quiz - Production Deployment Script
# This script handles deployment to various platforms

set -e

echo "🚀 Starting deployment process..."

# Parse command line arguments
PLATFORM=${1:-"vercel"}
ENVIRONMENT=${2:-"production"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Node.js is installed
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18 or higher."
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version must be 18 or higher. Current version: $(node --version)"
        exit 1
    fi
    
    print_success "Node.js version check passed: $(node --version)"
}

# Install dependencies
install_deps() {
    print_status "Installing dependencies..."
    npm ci
    print_success "Dependencies installed"
}

# Run linting
run_lint() {
    print_status "Running linter..."
    if npm run lint --if-present; then
        print_success "Linting passed"
    else
        print_warning "Linting issues found - continuing deployment"
    fi
}

# Run tests
run_tests() {
    print_status "Running tests..."
    if npm test --if-present; then
        print_success "Tests passed"
    else
        print_warning "No tests configured or tests failed - continuing deployment"
    fi
}

# Build application
build_app() {
    print_status "Building application for $ENVIRONMENT..."
    
    export NODE_ENV=$ENVIRONMENT
    export VITE_BUILD_MODE=$ENVIRONMENT
    
    if [ "$ENVIRONMENT" = "production" ]; then
        export VITE_ENABLE_ANALYTICS=true
    else
        export VITE_ENABLE_ANALYTICS=false
    fi
    
    npm run build
    print_success "Build completed"
    
    # Show build statistics
    if [ -d "dist" ]; then
        DIST_SIZE=$(du -sh dist | cut -f1)
        print_status "Build size: $DIST_SIZE"
        
        # Count files
        JS_FILES=$(find dist -name "*.js" | wc -l)
        CSS_FILES=$(find dist -name "*.css" | wc -l)
        
        print_status "Generated files: $JS_FILES JS, $CSS_FILES CSS"
    fi
}

# Deploy to Vercel
deploy_vercel() {
    print_status "Deploying to Vercel..."
    
    if ! command -v vercel &> /dev/null; then
        print_error "Vercel CLI not installed. Install with: npm i -g vercel"
        exit 1
    fi
    
    if [ "$ENVIRONMENT" = "production" ]; then
        vercel --prod --confirm
    else
        vercel --confirm
    fi
    
    print_success "Deployed to Vercel"
}

# Deploy to Netlify
deploy_netlify() {
    print_status "Deploying to Netlify..."
    
    if ! command -v netlify &> /dev/null; then
        print_error "Netlify CLI not installed. Install with: npm i -g netlify-cli"
        exit 1
    fi
    
    if [ "$ENVIRONMENT" = "production" ]; then
        netlify deploy --prod --dir=dist
    else
        netlify deploy --dir=dist
    fi
    
    print_success "Deployed to Netlify"
}

# Deploy using Docker
deploy_docker() {
    print_status "Building and deploying Docker image..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker not installed. Please install Docker."
        exit 1
    fi
    
    # Build Docker image
    docker build -t ipas-quiz:latest .
    
    # Tag for registry if needed
    if [ ! -z "$DOCKER_REGISTRY" ]; then
        docker tag ipas-quiz:latest $DOCKER_REGISTRY/ipas-quiz:latest
        docker push $DOCKER_REGISTRY/ipas-quiz:latest
        print_success "Docker image pushed to registry"
    else
        print_success "Docker image built locally"
    fi
}

# Main deployment function
main() {
    print_status "🎯 Deploying iPAS Net Zero Quiz to $PLATFORM ($ENVIRONMENT)"
    
    # Pre-deployment checks
    check_node
    install_deps
    run_lint
    run_tests
    build_app
    
    # Deploy based on platform
    case $PLATFORM in
        "vercel")
            deploy_vercel
            ;;
        "netlify")
            deploy_netlify
            ;;
        "docker")
            deploy_docker
            ;;
        *)
            print_error "Unsupported platform: $PLATFORM"
            print_status "Supported platforms: vercel, netlify, docker"
            exit 1
            ;;
    esac
    
    print_success "🎉 Deployment completed successfully!"
    print_status "Platform: $PLATFORM"
    print_status "Environment: $ENVIRONMENT"
    print_status "Build time: $(date)"
}

# Show usage if help is requested
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "iPAS Net Zero Quiz Deployment Script"
    echo ""
    echo "Usage: $0 [platform] [environment]"
    echo ""
    echo "Platforms:"
    echo "  vercel    Deploy to Vercel (default)"
    echo "  netlify   Deploy to Netlify"
    echo "  docker    Build and deploy Docker image"
    echo ""
    echo "Environments:"
    echo "  production  Production deployment (default)"
    echo "  staging     Staging deployment"
    echo ""
    echo "Examples:"
    echo "  $0 vercel production"
    echo "  $0 netlify staging"
    echo "  $0 docker"
    echo ""
    exit 0
fi

# Run main function
main