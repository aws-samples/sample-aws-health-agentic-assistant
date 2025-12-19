#!/bin/bash

echo ""
echo "⚠️  WARNING: This is for DEVELOPMENT ONLY"
echo "⚠️  For production deployment, see README_deploy_best_practices.md"
echo ""
echo "Press Ctrl+C to cancel, or wait 3 seconds to continue..."
sleep 3

echo "🚀 Starting AWS Health Dashboard..."

# Build React app
echo "📦 Building React app..."
cd client && npm run build && cd ..

# Start server
echo "🌐 Starting server on http://localhost:3001"
npm start
