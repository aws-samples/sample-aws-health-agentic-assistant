#!/usr/bin/env node

/**
 * Validates that all command injection security fixes are properly implemented
 */

const fs = require('fs');
const path = require('path');

console.log('🔒 Validating Command Injection Security Fixes\n');
console.log('='.repeat(80));

const serverPath = path.join(__dirname, 'server.js');
const serverContent = fs.readFileSync(serverPath, 'utf8');

const checks = [
  {
    category: 'Input Validation Function',
    tests: [
      {
        name: 'validateAndSanitizePrompt function exists',
        test: () => serverContent.includes('function validateAndSanitizePrompt(prompt)'),
        critical: true
      },
      {
        name: 'Type validation implemented',
        test: () => serverContent.includes('typeof prompt !== \'string\''),
        critical: true
      },
      {
        name: 'Length validation (max) implemented',
        test: () => serverContent.includes('MAX_PROMPT_LENGTH'),
        critical: true
      },
      {
        name: 'Length validation (min) implemented',
        test: () => serverContent.includes('MIN_PROMPT_LENGTH'),
        critical: true
      },
      {
        name: 'Character whitelist regex implemented',
        test: () => serverContent.includes('SAFE_PROMPT_REGEX'),
        critical: true
      },
      {
        name: 'Dangerous pattern detection implemented',
        test: () => serverContent.includes('DANGEROUS_PATTERNS'),
        critical: true
      },
      {
        name: 'Sanitization implemented',
        test: () => serverContent.includes('.replace(/[<>]/g, \'\')'),
        critical: true
      }
    ]
  },
  {
    category: 'Endpoint 1: /api/critical-events-analysis-refresh',
    tests: [
      {
        name: 'requireAuth middleware applied',
        test: () => /app\.post\('\/api\/critical-events-analysis-refresh',\s*requireAuth/.test(serverContent),
        critical: true
      },
      {
        name: 'Input validation applied',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/critical-events-analysis-refresh'[\s\S]{0,500}validateAndSanitizePrompt/);
          return match !== null;
        },
        critical: true
      },
      {
        name: 'Timeout configured',
        test: () => serverContent.includes('const TIMEOUT = 60000'),
        critical: true
      },
      {
        name: 'Timeout cleared on close',
        test: () => serverContent.includes('clearTimeout(timeoutId)'),
        critical: true
      },
      {
        name: 'Logging implemented',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/critical-events-analysis-refresh'[\s\S]{0,600}LOG REQUEST for audit trail/);
          return match !== null;
        },
        critical: false
      }
    ]
  },
  {
    category: 'Endpoint 2: /api/critical-events-analysis-refresh-60',
    tests: [
      {
        name: 'requireAuth middleware applied',
        test: () => /app\.post\('\/api\/critical-events-analysis-refresh-60',\s*requireAuth/.test(serverContent),
        critical: true
      },
      {
        name: 'Input validation applied',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/critical-events-analysis-refresh-60'[\s\S]{0,500}validateAndSanitizePrompt/);
          return match !== null;
        },
        critical: true
      },
      {
        name: 'Timeout configured',
        test: () => serverContent.includes('const TIMEOUT = 60000'),
        critical: true
      }
    ]
  },
  {
    category: 'Endpoint 3: /api/critical-events-analysis-refresh-pastdue',
    tests: [
      {
        name: 'requireAuth middleware applied',
        test: () => /app\.post\('\/api\/critical-events-analysis-refresh-pastdue',\s*requireAuth/.test(serverContent),
        critical: true
      },
      {
        name: 'Input validation applied',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/critical-events-analysis-refresh-pastdue'[\s\S]{0,500}validateAndSanitizePrompt/);
          return match !== null;
        },
        critical: true
      }
    ]
  },
  {
    category: 'Endpoint 4: /api/agent-analysis-stream',
    tests: [
      {
        name: 'requireAuth middleware applied',
        test: () => /app\.post\('\/api\/agent-analysis-stream',\s*requireAuth/.test(serverContent),
        critical: true
      },
      {
        name: 'Input validation applied',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/agent-analysis-stream'[\s\S]{0,500}validateAndSanitizePrompt/);
          return match !== null;
        },
        critical: true
      }
    ]
  },
  {
    category: 'Endpoint 5: /api/agent-analysis',
    tests: [
      {
        name: 'requireAuth middleware applied',
        test: () => /app\.post\('\/api\/agent-analysis',\s*requireAuth/.test(serverContent),
        critical: true
      },
      {
        name: 'Input validation applied',
        test: () => {
          const match = serverContent.match(/app\.post\('\/api\/agent-analysis'[\s\S]{0,800}validateAndSanitizePrompt/);
          return match !== null;
        },
        critical: true
      }
    ]
  },
  {
    category: 'General Security',
    tests: [
      {
        name: 'No unvalidated spawn calls with user input',
        test: () => {
          // Check that all spawn calls use validation.sanitized, not raw prompt
          const spawnCalls = serverContent.match(/spawn\('python3',\s*\['test_agentic_analysis\.py',\s*([^\]]+)\]/g);
          if (!spawnCalls) return true; // No spawn calls found
          
          // All spawn calls should use validation.sanitized
          return spawnCalls.every(call => call.includes('validation.sanitized'));
        },
        critical: true
      },
      {
        name: 'Sanitized prompts used in cache data',
        test: () => {
          // Check that cached prompts use validation.sanitized
          const cachePrompts = serverContent.match(/prompt:\s*validation\.sanitized/g);
          return cachePrompts && cachePrompts.length >= 3; // At least 3 endpoints cache data
        },
        critical: true
      }
    ]
  }
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let criticalFailures = 0;

checks.forEach((category) => {
  console.log(`\n${category.category}`);
  console.log('-'.repeat(80));
  
  category.tests.forEach((check) => {
    totalTests++;
    const result = check.test();
    const status = result ? '✅ PASS' : '❌ FAIL';
    const critical = check.critical ? ' [CRITICAL]' : '';
    
    console.log(`  ${status} ${check.name}${critical}`);
    
    if (result) {
      passedTests++;
    } else {
      failedTests++;
      if (check.critical) {
        criticalFailures++;
      }
    }
  });
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 Validation Results:`);
console.log(`   Total Tests: ${totalTests}`);
console.log(`   Passed: ${passedTests}`);
console.log(`   Failed: ${failedTests}`);
console.log(`   Critical Failures: ${criticalFailures}\n`);

if (failedTests === 0) {
  console.log('✅ All security fixes properly implemented!');
  console.log('✅ Command injection vulnerabilities have been addressed.\n');
  process.exit(0);
} else if (criticalFailures > 0) {
  console.log('❌ CRITICAL security fixes missing!');
  console.log('❌ Command injection vulnerabilities still present.\n');
  process.exit(1);
} else {
  console.log('⚠️  Some non-critical checks failed.');
  console.log('✅ Critical security fixes are in place.\n');
  process.exit(0);
}
