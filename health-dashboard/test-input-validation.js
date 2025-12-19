#!/usr/bin/env node

/**
 * Test script to validate the input validation and sanitization function
 */

// Copy the validation function from server.js
function validateAndSanitizePrompt(prompt) {
  // Check 1: Type validation
  if (!prompt || typeof prompt !== 'string') {
    return { 
      valid: false, 
      error: 'Prompt must be a non-empty string' 
    };
  }

  // Check 2: Length validation (prevent DoS)
  const MAX_PROMPT_LENGTH = 5000;
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { 
      valid: false, 
      error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` 
    };
  }

  // Check 3: Minimum length
  const MIN_PROMPT_LENGTH = 3;
  if (prompt.trim().length < MIN_PROMPT_LENGTH) {
    return { 
      valid: false, 
      error: `Prompt must be at least ${MIN_PROMPT_LENGTH} characters` 
    };
  }

  // Check 4: Character whitelist (allow alphanumeric + safe punctuation)
  const SAFE_PROMPT_REGEX = /^[a-zA-Z0-9\s.,!?;:()\-'"@#%&*+=\[\]{}\/\\]+$/;
  if (!SAFE_PROMPT_REGEX.test(prompt)) {
    return { 
      valid: false, 
      error: 'Prompt contains invalid characters' 
    };
  }

  // Check 5: Block dangerous patterns
  const DANGEROUS_PATTERNS = [
    /\$\(/,           // Command substitution
    /`/,              // Backticks
    /<\s*script/i,    // Script tags
    /\|\s*python/i,   // Pipe to python
    /;\s*python/i,    // Semicolon python
    /&&\s*python/i,   // AND python
    /\|\|\s*python/i, // OR python
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(prompt)) {
      return { 
        valid: false, 
        error: 'Prompt contains potentially dangerous patterns' 
      };
    }
  }

  // Sanitization: Remove potentially dangerous characters
  const sanitized = prompt
    .replace(/[<>]/g, '')     // Remove angle brackets
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim();

  return { 
    valid: true, 
    sanitized: sanitized,
    error: null 
  };
}

// Test cases
const testCases = [
  {
    name: 'Valid prompt - simple text',
    input: 'Analyze critical events for the next 30 days',
    expectedValid: true
  },
  {
    name: 'Valid prompt - with punctuation',
    input: 'What are the high-risk events? Show me details!',
    expectedValid: true
  },
  {
    name: 'Invalid - empty string',
    input: '',
    expectedValid: false
  },
  {
    name: 'Invalid - null',
    input: null,
    expectedValid: false
  },
  {
    name: 'Invalid - too short',
    input: 'ab',
    expectedValid: false
  },
  {
    name: 'Invalid - command substitution',
    input: 'Show events $(whoami)',
    expectedValid: false
  },
  {
    name: 'Invalid - backticks',
    input: 'Show events `ls -la`',
    expectedValid: false
  },
  {
    name: 'Invalid - script tag',
    input: 'Show events <script>alert(1)</script>',
    expectedValid: false
  },
  {
    name: 'Invalid - pipe to python',
    input: 'Show events | python malicious.py',
    expectedValid: false
  },
  {
    name: 'Invalid - semicolon python',
    input: 'Show events; python malicious.py',
    expectedValid: false
  },
  {
    name: 'Invalid - AND python',
    input: 'Show events && python malicious.py',
    expectedValid: false
  },
  {
    name: 'Invalid - OR python',
    input: 'Show events || python malicious.py',
    expectedValid: false
  },
  {
    name: 'Invalid - angle brackets (security risk)',
    input: 'Show events <test>',
    expectedValid: false
  },
  {
    name: 'Invalid - too long',
    input: 'a'.repeat(5001),
    expectedValid: false
  },
  {
    name: 'Invalid - dollar sign (command substitution risk)',
    input: 'Cost: $100, Savings: 50%, Impact: #1',
    expectedValid: false
  },
  {
    name: 'Valid - safe special characters',
    input: 'Cost: 100, Savings: 50%, Impact: #1',
    expectedValid: true
  }
];

console.log('🧪 Testing Input Validation Function\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  console.log(`\nTest ${index + 1}: ${testCase.name}`);
  console.log('-'.repeat(80));
  
  const result = validateAndSanitizePrompt(testCase.input);
  const testPassed = result.valid === testCase.expectedValid;
  
  console.log(`Input:    ${typeof testCase.input === 'string' ? `"${testCase.input.substring(0, 50)}${testCase.input.length > 50 ? '...' : ''}"` : testCase.input}`);
  console.log(`Expected: ${testCase.expectedValid ? 'VALID' : 'INVALID'}`);
  console.log(`Actual:   ${result.valid ? 'VALID' : 'INVALID'}`);
  
  if (!result.valid) {
    console.log(`Error:    ${result.error}`);
  } else if (testCase.expectedSanitized) {
    const sanitizedMatch = result.sanitized === testCase.expectedSanitized;
    console.log(`Sanitized: "${result.sanitized}"`);
    console.log(`Expected:  "${testCase.expectedSanitized}"`);
    console.log(`Match:     ${sanitizedMatch ? 'YES' : 'NO'}`);
    if (!sanitizedMatch) {
      console.log(`Status:    ❌ FAIL (sanitization mismatch)`);
      failed++;
      return;
    }
  }
  
  console.log(`Status:    ${testPassed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (testPassed) {
    passed++;
  } else {
    failed++;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests\n`);

if (failed === 0) {
  console.log('✅ All input validation tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some input validation tests failed!\n');
  process.exit(1);
}
