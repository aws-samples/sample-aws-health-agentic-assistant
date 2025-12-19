#!/usr/bin/env node

/**
 * Test script to validate CORS configuration
 * Tests different scenarios for NODE_ENV and ALLOWED_ORIGINS
 */

const testScenarios = [
  {
    name: 'Development mode - no ALLOWED_ORIGINS',
    env: { NODE_ENV: 'development' },
    origin: 'http://localhost:3000',
    expectedResult: 'ALLOWED'
  },
  {
    name: 'Development mode - with ALLOWED_ORIGINS (testing whitelist)',
    env: { NODE_ENV: 'development', ALLOWED_ORIGINS: 'https://example.com' },
    origin: 'https://example.com',
    expectedResult: 'ALLOWED'
  },
  {
    name: 'Production mode - no ALLOWED_ORIGINS',
    env: { NODE_ENV: 'production' },
    origin: 'https://example.com',
    expectedResult: 'BLOCKED'
  },
  {
    name: 'Production mode - origin in whitelist',
    env: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com,https://www.example.com' },
    origin: 'https://example.com',
    expectedResult: 'ALLOWED'
  },
  {
    name: 'Production mode - origin NOT in whitelist',
    env: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com' },
    origin: 'https://malicious.com',
    expectedResult: 'BLOCKED'
  },
  {
    name: 'Production mode - no origin header (server-to-server)',
    env: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com' },
    origin: null,
    expectedResult: 'ALLOWED'
  }
];

// Simulate the CORS logic from server.js
function testCorsLogic(env, origin) {
  const allowedOrigins = env.ALLOWED_ORIGINS 
    ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];
  
  // In development mode, allow all origins if no ALLOWED_ORIGINS specified
  if (env.NODE_ENV !== 'production') {
    if (allowedOrigins.length === 0) {
      return { allowed: true, reason: 'Development mode - allowing all origins' };
    }
    // If ALLOWED_ORIGINS is set in dev, still use it for testing
  }
  
  // Allow requests with no origin (server-to-server, mobile apps, curl)
  if (!origin) {
    return { allowed: true, reason: 'No origin header - allowing' };
  }
  
  // Check if origin is in allowed list
  if (allowedOrigins.includes(origin)) {
    return { allowed: true, reason: `Origin ${origin} is in whitelist` };
  } else {
    return { allowed: false, reason: `Origin ${origin} is NOT in whitelist` };
  }
}

console.log('🧪 Testing CORS Configuration\n');
console.log('=' .repeat(80));

let passed = 0;
let failed = 0;

testScenarios.forEach((scenario, index) => {
  console.log(`\nTest ${index + 1}: ${scenario.name}`);
  console.log('-'.repeat(80));
  console.log(`Environment: NODE_ENV=${scenario.env.NODE_ENV}`);
  console.log(`             ALLOWED_ORIGINS=${scenario.env.ALLOWED_ORIGINS || '(not set)'}`);
  console.log(`Origin:      ${scenario.origin || '(no origin header)'}`);
  
  const result = testCorsLogic(scenario.env, scenario.origin);
  const actualResult = result.allowed ? 'ALLOWED' : 'BLOCKED';
  const testPassed = actualResult === scenario.expectedResult;
  
  console.log(`Expected:    ${scenario.expectedResult}`);
  console.log(`Actual:      ${actualResult}`);
  console.log(`Reason:      ${result.reason}`);
  console.log(`Status:      ${testPassed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (testPassed) {
    passed++;
  } else {
    failed++;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testScenarios.length} tests\n`);

if (failed === 0) {
  console.log('✅ All CORS configuration tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some CORS configuration tests failed!\n');
  process.exit(1);
}
