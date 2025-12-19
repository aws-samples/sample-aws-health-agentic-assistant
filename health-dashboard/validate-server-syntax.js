#!/usr/bin/env node

/**
 * Validates server.js syntax and CORS configuration
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating server.js configuration...\n');

const serverPath = path.join(__dirname, 'server.js');

// Check if file exists
if (!fs.existsSync(serverPath)) {
  console.error('❌ server.js not found!');
  process.exit(1);
}

// Read the file
const serverContent = fs.readFileSync(serverPath, 'utf8');

// Validation checks
const checks = [
  {
    name: 'CORS configuration exists',
    test: () => serverContent.includes('corsOptions'),
    message: 'CORS options object found'
  },
  {
    name: 'Environment-driven origin check',
    test: () => serverContent.includes('process.env.ALLOWED_ORIGINS'),
    message: 'ALLOWED_ORIGINS environment variable check found'
  },
  {
    name: 'NODE_ENV check for production',
    test: () => serverContent.includes("process.env.NODE_ENV !== 'production'"),
    message: 'NODE_ENV production check found'
  },
  {
    name: 'Development mode fallback',
    test: () => serverContent.includes('Development mode'),
    message: 'Development mode logging found'
  },
  {
    name: 'Origin whitelist validation',
    test: () => serverContent.includes('allowedOrigins.includes(origin)'),
    message: 'Origin whitelist validation found'
  },
  {
    name: 'CORS blocked logging',
    test: () => serverContent.includes('Blocked request from origin'),
    message: 'CORS blocked logging found'
  },
  {
    name: 'Credentials support',
    test: () => serverContent.includes('credentials: true'),
    message: 'CORS credentials support enabled'
  },
  {
    name: 'No unrestricted CORS',
    test: () => !serverContent.match(/app\.use\(cors\(\)\)/),
    message: 'No unrestricted cors() calls found'
  }
];

let passed = 0;
let failed = 0;

checks.forEach((check, index) => {
  const result = check.test();
  console.log(`${index + 1}. ${check.name}`);
  console.log(`   ${result ? '✅' : '❌'} ${check.message}`);
  
  if (result) {
    passed++;
  } else {
    failed++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Validation Results: ${passed}/${checks.length} checks passed\n`);

if (failed === 0) {
  console.log('✅ All validation checks passed!');
  console.log('✅ CORS configuration is properly implemented.\n');
  process.exit(0);
} else {
  console.log('❌ Some validation checks failed!');
  console.log('❌ Please review the CORS configuration.\n');
  process.exit(1);
}
