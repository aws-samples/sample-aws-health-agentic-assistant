require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const AWS = require('aws-sdk');
const session = require('express-session');

// Use virtual environment Python
const PYTHON_PATH = path.join(__dirname, '..', '.venv', 'bin', 'python3');

// Configure AWS SDK
AWS.config.update({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();
// const dynamodb = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });
// const cognito = new AWS.CognitoIdentityServiceProvider({ region: 'us-west-2' });

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Validates and sanitizes user prompt input to prevent command injection
 * @param {string} prompt - User-provided prompt
 * @returns {object} { valid: boolean, sanitized: string, error: string }
 */
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

  // Check 4: Character whitelist (allow alphanumeric + safe punctuation + newlines)
  const SAFE_PROMPT_REGEX = /^[a-zA-Z0-9\s.,!?;:()\-'"@#%&*+=\[\]{}\/\\`\n\r_<>]+$/;
  if (!SAFE_PROMPT_REGEX.test(prompt)) {
    return { 
      valid: false, 
      error: 'Prompt contains invalid characters' 
    };
  }

  // Check 5: Block dangerous patterns
  const DANGEROUS_PATTERNS = [
    /\$\(/,           // Command substitution
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

// Cognito configuration - loaded from environment variables
const COGNITO_CONFIG = {
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID,
    ClientSecret: process.env.COGNITO_CLIENT_SECRET
};

// Validate required Cognito configuration
if (!COGNITO_CONFIG.UserPoolId || !COGNITO_CONFIG.ClientId || !COGNITO_CONFIG.ClientSecret) {
    console.error('❌ Missing required Cognito configuration. Please set environment variables:');
    console.error('   - COGNITO_USER_POOL_ID');
    console.error('   - COGNITO_CLIENT_ID');
    console.error('   - COGNITO_CLIENT_SECRET');
    process.exit(1);
}

// CORS configuration - fully environment-driven
const corsOptions = {
  origin: function (origin, callback) {
    // Get allowed origins from environment variable
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];
    
    // In development mode, allow all origins if no ALLOWED_ORIGINS specified
    if (process.env.NODE_ENV !== 'production') {
      if (allowedOrigins.length === 0) {
        console.log('🔓 CORS: Development mode - allowing all origins');
        return callback(null, true);
      }
      // If ALLOWED_ORIGINS is set in dev, still use it for testing
    }
    
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ CORS: Allowed origin: ${origin}`);
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS: Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(session({
    secret: 'chaplin-dashboard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

// Login route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const params = {
            UserPoolId: COGNITO_CONFIG.UserPoolId,
            Username: username,
            TemporaryPassword: password,
            MessageAction: 'SUPPRESS'
        };
        
        // Try admin authentication first
        try {
            const result = await cognito.adminInitiateAuth({
                UserPoolId: COGNITO_CONFIG.UserPoolId,
                ClientId: COGNITO_CONFIG.ClientId,
                AuthFlow: 'ADMIN_NO_SRP_AUTH',
                AuthParameters: {
                    USERNAME: username,
                    PASSWORD: password,
                    SECRET_HASH: require('crypto').createHmac('SHA256', COGNITO_CONFIG.ClientSecret).update(username + COGNITO_CONFIG.ClientId).digest('base64')
                }
            }).promise();
            
            req.session.user = { username, tokens: result.AuthenticationResult };
            res.json({ success: true, user: { username } });
        } catch (authError) {
            console.log('Auth error:', authError.message);
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.log('Login error:', error.message);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Signup route
app.post('/api/signup', async (req, res) => {
    const { email, password } = req.body;
    
    // Validate @amazon.com domain
    if (!email.endsWith('@amazon.com')) {
        return res.status(400).json({ error: 'Only @amazon.com email addresses are allowed' });
    }
    
    try {
        const params = {
            ClientId: COGNITO_CONFIG.ClientId,
            Username: email,
            Password: password,
            UserAttributes: [
                { Name: 'email', Value: email }
            ],
            SecretHash: require('crypto').createHmac('SHA256', COGNITO_CONFIG.ClientSecret).update(email + COGNITO_CONFIG.ClientId).digest('base64')
        };
        
        await cognito.signUp(params).promise();
        res.json({ success: true, message: 'Account created successfully! Please check your email for verification code.' });
    } catch (error) {
        console.log('Signup error:', error.message);
        if (error.code === 'UsernameExistsException') {
            res.status(400).json({ error: 'User already exists' });
        } else {
            res.status(400).json({ error: error.message || 'Failed to create account' });
        }
    }
});

// Email verification route
app.post('/api/verify-email', async (req, res) => {
    const { email, code } = req.body;
    
    try {
        const params = {
            ClientId: COGNITO_CONFIG.ClientId,
            Username: email,
            ConfirmationCode: code,
            SecretHash: require('crypto').createHmac('SHA256', COGNITO_CONFIG.ClientSecret).update(email + COGNITO_CONFIG.ClientId).digest('base64')
        };
        
        await cognito.confirmSignUp(params).promise();
        res.json({ success: true, message: 'Email verified successfully! You can now login.' });
    } catch (error) {
        console.log('Verification error:', error.message);
        res.status(400).json({ error: error.message || 'Verification failed' });
    }
});

// Logout route
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.user });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info, callback) => {
    const cookies = info.req.headers.cookie;
    if (!cookies) {
      callback(false, 401, 'Unauthorized');
      return;
    }
    callback(true);
  }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  
  // Send connection confirmation
  ws.send(JSON.stringify({ type: 'connection_established', timestamp: new Date().toISOString() }));
  
  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 5000);
  
  ws.on('pong', () => {
    console.log('🔌 WebSocket heartbeat received');
  });
  
  ws.on('error', (error) => {
    console.error('🔌 WebSocket error:', error);
    clearInterval(heartbeat);
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clearInterval(heartbeat);
  });
});

// Broadcast to all WebSocket clients
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('🔌 WebSocket broadcast error:', error);
      }
    }
  });
}

// API Routes
app.get('/api/event-categories', requireAuth, async (req, res) => {
  try {
    const cacheFile = path.join(__dirname, '../output/event-categories-cache.json');
    
    // Check if cache exists and return it
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return res.json(cacheData);
    }
    
    // If no cache, generate and cache the data
    const data = await generateEventCategoriesData();
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (error) {
    console.error('Error fetching event categories:', error);
    res.status(500).json({ error: 'Failed to load event categories' });
  }
});

async function generateEventCategoriesData() {
  const scanAllPages = async (params) => {
    let allItems = [];
    let lastEvaluatedKey = null;
    
    do {
      const scanParams = { ...params };
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      
      const result = await dynamodb.scan(scanParams).promise();
      const pageItems = result.Items || [];
      allItems = allItems.concat(pageItems);
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return { Items: allItems };
  };
  
  const issueParams = {
    TableName: 'chaplin-health-events',
    ProjectionExpression: 'eventCategory, service',
    FilterExpression: 'eventCategory = :cat',
    ExpressionAttributeValues: { ':cat': 'issue' }
  };
  
  const accountParams = {
    TableName: 'chaplin-health-events',
    ProjectionExpression: 'eventCategory, service',
    FilterExpression: 'eventCategory = :cat',
    ExpressionAttributeValues: { ':cat': 'accountNotification' }
  };
  
  const scheduledParams = {
    TableName: 'chaplin-health-events',
    ProjectionExpression: 'eventCategory, service',
    FilterExpression: 'eventCategory = :cat',
    ExpressionAttributeValues: { ':cat': 'scheduledChange' }
  };
  
  const investigationParams = {
    TableName: 'chaplin-health-events',
    ProjectionExpression: 'eventCategory, service',
    FilterExpression: 'eventCategory = :cat',
    ExpressionAttributeValues: { ':cat': 'investigation' }
  };
  
  const [issueResult, accountResult, scheduledResult, investigationResult] = await Promise.all([
    scanAllPages(issueParams),
    scanAllPages(accountParams),
    scanAllPages(scheduledParams),
    scanAllPages(investigationParams)
  ]);
  
  const issueServices = new Set();
  issueResult.Items.forEach(item => {
    if (item.service) issueServices.add(item.service);
  });
  
  const accountServices = new Set();
  accountResult.Items.forEach(item => {
    if (item.service) accountServices.add(item.service);
  });
  
  const scheduledServices = new Set();
  scheduledResult.Items.forEach(item => {
    if (item.service) scheduledServices.add(item.service);
  });
  
  const investigationServices = new Set();
  investigationResult.Items.forEach(item => {
    if (item.service) investigationServices.add(item.service);
  });
  
  return {
    data: [
      {
        id: 'issue',
        name: 'Issue',
        description: 'Service issues and outages',
        eventCount: issueResult.Items.length,
        serviceCount: issueServices.size
      },
      {
        id: 'accountNotification',
        name: 'Account Notification',
        description: 'Account-specific notifications',
        eventCount: accountResult.Items.length,
        serviceCount: accountServices.size
      },
      {
        id: 'scheduledChange',
        name: 'Scheduled Change',
        description: 'Planned maintenance and changes',
        eventCount: scheduledResult.Items.length,
        serviceCount: scheduledServices.size
      },
      {
        id: 'investigation',
        name: 'Investigation',
        description: 'AWS investigations',
        eventCount: investigationResult.Items.length,
        serviceCount: investigationServices.size
      }
    ],
    lastRefreshed: new Date().toISOString()
  };
}

app.get('/api/event-category-details/:categoryId', requireAuth, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const cacheFile = path.join(__dirname, '../output', `event-category-${categoryId}-cache.json`);
    
    // Check if cache exists and return it
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      
      // Transform data to match React component expectations
      const transformedEvents = cacheData.data.map(event => ({
        ...event,
        title: event.__summary?.title || event.eventCategory || event.name || 'N/A',
        event: event.__summary?.schedule?.[0]?.event || event.event_type || 'N/A', 
        risk: event.__summary?.risk || 'N/A',
        schedule_datetime: event.__summary?.schedule?.[0]?.datetime || null
      }));
      
      return res.json({ 
        category: categoryId, 
        events: transformedEvents,
        count: transformedEvents.length,
        lastUpdated: cacheData.lastUpdated
      });
    }
    
    console.log(`Cache file not found for ${categoryId}, generating...`);
    
    // If no cache, generate and cache the data
    const scanAllPages = async (params) => {
      let allItems = [];
      let lastEvaluatedKey = null;
      
      do {
        const scanParams = { ...params };
        if (lastEvaluatedKey) {
          scanParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.scan(scanParams).promise();
        const pageItems = result.Items || [];
        allItems = allItems.concat(pageItems);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      return allItems;
    };
    
    const params = {
      TableName: 'chaplin-health-events',
      FilterExpression: 'eventCategory = :category',
      ExpressionAttributeValues: {
        ':category': categoryId
      }
    };
    
    const events = await scanAllPages(params);
    const cacheData = {
      data: events,
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    
    // Transform data to match React component expectations
    const transformedEvents = events.map(event => ({
      ...event,
      title: event.__summary?.title || event.eventCategory || event.name || 'N/A',
      event: event.__summary?.schedule?.[0]?.event || event.event_type || 'N/A',
      risk: event.__summary?.risk || 'N/A',
      schedule_datetime: event.__summary?.schedule?.[0]?.datetime || null
    }));
    
    res.json({ 
      category: categoryId, 
      events: transformedEvents,
      count: transformedEvents.length,
      lastUpdated: cacheData.lastUpdated
    });
  } catch (error) {
    console.error('Error fetching category details:', error);
    res.status(500).json({ error: 'Failed to load category details' });
  }
});

app.get('/api/event-type-stats', requireAuth, async (req, res) => {
  try {
    const cacheFile = path.join(__dirname, '../output/event-type-stats-cache.json');
    
    // Check if cache exists and return it
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return res.json(cacheData);
    }
    
    // If no cache, generate and cache the data
    const data = await generateEventTypeStatsData();
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (error) {
    console.error('Error fetching event type stats:', error);
    res.status(500).json({ error: 'Failed to load event type stats' });
  }
});

app.get('/api/event-type-details/:eventTypeId', requireAuth, async (req, res) => {
  try {
    const { eventTypeId } = req.params;
    const cacheFile = path.join(__dirname, '../output', `event-type-${eventTypeId}-cache.json`);
    
    // Check if cache exists and return it
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      
      // Transform data to match React component expectations
      const transformedEvents = cacheData.data.map(event => ({
        ...event,
        title: event.__summary?.title || event.eventCategory || event.name || 'N/A',
        event: event.__summary?.schedule?.[0]?.event || event.event_type || 'N/A', 
        risk: event.__summary?.risk || 'N/A',
        schedule_datetime: event.__summary?.schedule?.[0]?.datetime || null
      }));
      
      return res.json({ 
        eventType: eventTypeId, 
        events: transformedEvents,
        count: transformedEvents.length,
        lastUpdated: cacheData.lastUpdated
      });
    }
    
    console.log(`Cache file not found for event type ${eventTypeId}, generating...`);
    
    // Generate data based on event type patterns
    const patterns = {
      'configuration-alerts': [/.*_HIGH_RISK_CONFIG.*/, /.*_PERSISTENCE_EXPIRING$/, /.*_RENEWAL_STATE_CHANGE$/, /.*_CUSTOMER_ENGAGEMENT$/, /.*_RUNAWAY_TERMINATION.*/],
      'cost-impact-events': [/AWS_BILLING_NOTIFICATION$/, /.*_ODCR_.*/, /.*_SUBSCRIPTION_RENEWAL.*/, /.*_CAPACITY_.*/, /.*_UNDERUTILIZATION.*/],
      'maintenance-updates': [/.*_MAINTENANCE_SCHEDULED$/, /.*_MAINTENANCE_COMPLETE$/, /.*_MAINTENANCE_EXTENSION$/, /.*_UPDATE_AVAILABLE$/, /.*_UPDATE_COMPLETED$/, /.*_AUTO_UPGRADE_NOTIFICATION$/, /.*_UPCOMING_MAINTENANCE$/],
      'migration-requirements': [/.*_PLANNED_LIFECYCLE_EVENT$/, /.*_PERSISTENT_INSTANCE_RETIREMENT_SCHEDULED$/, /.*_TASK_PATCHING_RETIREMENT$/, /.*_VM_DEPRECATED$/],
      'operational-notifications': [/.*_OPERATIONAL_NOTIFICATION$/, /.*_OPERATIONAL_ISSUE$/, /.*_SERVICE_ISSUE$/, /.*_CLUSTER_HEALTH_ISSUES$/, /.*_POD_EVICTIONS$/, /.*_REDUNDANCY_LOSS$/, /.*_TUNNEL_NOTIFICATION$/, /.*_EXPERIMENT_EVENT$/],
      'security-compliance': [/.*_SECURITY_NOTIFICATION$/, /.*_SECURITY_PATCHING_EVENT$/]
    };
    
    const eventPatterns = patterns[eventTypeId];
    if (!eventPatterns) {
      return res.status(404).json({ error: 'Event type not found' });
    }
    
    const scanAllPages = async (params) => {
      let allItems = [];
      let lastEvaluatedKey = null;
      
      do {
        const scanParams = { ...params };
        if (lastEvaluatedKey) {
          scanParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.scan(scanParams).promise();
        const pageItems = result.Items || [];
        allItems = allItems.concat(pageItems);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      return allItems;
    };
    
    const params = {
      TableName: 'chaplin-health-events'
    };
    
    const allEvents = await scanAllPages(params);
    const filteredEvents = allEvents.filter(event => {
      const eventType = event.event_type || '';
      return eventPatterns.some(pattern => pattern.test(eventType));
    });
    
    const cacheData = {
      data: filteredEvents,
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    
    // Transform data to match React component expectations
    const transformedEvents = filteredEvents.map(event => ({
      ...event,
      title: event.__summary?.title || event.eventCategory || event.name || 'N/A',
      event: event.__summary?.schedule?.[0]?.event || event.event_type || 'N/A',
      risk: event.__summary?.risk || 'N/A',
      schedule_datetime: event.__summary?.schedule?.[0]?.datetime || null
    }));
    
    res.json({ 
      eventType: eventTypeId, 
      events: transformedEvents,
      count: transformedEvents.length,
      lastUpdated: cacheData.lastUpdated
    });
  } catch (error) {
    console.error('Error fetching event type details:', error);
    res.status(500).json({ error: 'Failed to load event type details' });
  }
});

async function generateEventTypeStatsData() {
  const params = {
    TableName: 'chaplin-health-events',
    ProjectionExpression: 'event_type, service'
  };
  
  const scanAllPages = async (params) => {
    let allItems = [];
    let lastEvaluatedKey = null;
    
    do {
      const scanParams = { ...params };
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      
      const result = await dynamodb.scan(scanParams).promise();
      const pageItems = result.Items || [];
      allItems = allItems.concat(pageItems);
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return allItems;
  };
  
  const allEvents = await scanAllPages(params);
  
  const patterns = {
    configurationAlerts: [/.*_HIGH_RISK_CONFIG.*/, /.*_PERSISTENCE_EXPIRING$/, /.*_RENEWAL_STATE_CHANGE$/, /.*_CUSTOMER_ENGAGEMENT$/, /.*_RUNAWAY_TERMINATION.*/],
    costImpactEvents: [/AWS_BILLING_NOTIFICATION$/, /.*_ODCR_.*/, /.*_SUBSCRIPTION_RENEWAL.*/, /.*_CAPACITY_.*/, /.*_UNDERUTILIZATION.*/],
    maintenanceUpdates: [/.*_MAINTENANCE_SCHEDULED$/, /.*_MAINTENANCE_COMPLETE$/, /.*_MAINTENANCE_EXTENSION$/, /.*_UPDATE_AVAILABLE$/, /.*_UPDATE_COMPLETED$/, /.*_AUTO_UPGRADE_NOTIFICATION$/, /.*_UPCOMING_MAINTENANCE$/],
    migrationRequirements: [/.*_PLANNED_LIFECYCLE_EVENT$/, /.*_PERSISTENT_INSTANCE_RETIREMENT_SCHEDULED$/, /.*_TASK_PATCHING_RETIREMENT$/, /.*_VM_DEPRECATED$/],
    operationalNotifications: [/.*_OPERATIONAL_NOTIFICATION$/, /.*_OPERATIONAL_ISSUE$/, /.*_SERVICE_ISSUE$/, /.*_CLUSTER_HEALTH_ISSUES$/, /.*_POD_EVICTIONS$/, /.*_REDUNDANCY_LOSS$/, /.*_TUNNEL_NOTIFICATION$/, /.*_EXPERIMENT_EVENT$/],
    securityCompliance: [/.*_SECURITY_NOTIFICATION$/, /.*_SECURITY_PATCHING_EVENT$/]
  };
  
  const stats = {};
  
  Object.keys(patterns).forEach(category => {
    const categoryEvents = allEvents.filter(event => {
      const eventType = event.event_type || '';
      return patterns[category].some(pattern => pattern.test(eventType));
    });
    
    const services = new Set();
    categoryEvents.forEach(event => {
      if (event.service) services.add(event.service);
    });
    
    stats[category] = {
      eventCount: categoryEvents.length,
      serviceCount: services.size
    };
  });
  
  return {
    data: stats,
    lastRefreshed: new Date().toISOString()
  };
}
app.get('/api/categories', requireAuth, (req, res) => {
  try {
    const outputDir = path.join(__dirname, '../output');
    const files = fs.readdirSync(outputDir);
    const categoryFiles = files.filter(f => f.startsWith('category_') && f.endsWith('.json'));
    
    const categories = categoryFiles.map(file => {
      const data = JSON.parse(fs.readFileSync(path.join(outputDir, file), 'utf8'));
      return {
        id: data.category,
        name: data.category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: data.description,
        totalEvents: data.summary.total_events,
        upcomingEvents: data.summary.upcoming_events,
        servicesAffected: data.summary.services_affected,
        regionsAffected: data.summary.regions_affected,
        filename: file
      };
    });
    
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.get('/api/category/:categoryId', (req, res) => {
  try {
    const { categoryId } = req.params;
    const outputDir = path.join(__dirname, '../output');
    const files = fs.readdirSync(outputDir);
    const categoryFile = files.find(f => f.includes(`category_${categoryId}_`));
    
    if (!categoryFile) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, categoryFile), 'utf8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load category details' });
  }
});

// Cache event category details
app.get('/api/cache-event-category-details/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    
    const scanAllPages = async (params) => {
      let allItems = [];
      let lastEvaluatedKey = null;
      
      do {
        const scanParams = { ...params };
        if (lastEvaluatedKey) {
          scanParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.scan(scanParams).promise();
        const pageItems = result.Items || [];
        allItems = allItems.concat(pageItems);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      return allItems;
    };
    
    const params = {
      TableName: 'chaplin-health-events',
      FilterExpression: 'eventCategory = :category',
      ExpressionAttributeValues: {
        ':category': categoryId
      }
    };
    
    const events = await scanAllPages(params);
    const cacheData = {
      data: events,
      lastUpdated: new Date().toISOString()
    };
    
    const fileName = `event-category-${categoryId}-cache.json`;
    fs.writeFileSync(path.join(__dirname, '../output', fileName), JSON.stringify(cacheData, null, 2));
    res.json({ success: true, count: events.length });
  } catch (error) {
    console.error('Error caching event category details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Refresh cache endpoint
app.post('/api/refresh-cache', async (req, res) => {
  try {
    console.log('🔄 Refreshing cache data...');
    
    // Clear existing cache files
    const eventCategoriesCache = path.join(__dirname, '../output/event-categories-cache.json');
    const eventTypeStatsCache = path.join(__dirname, '../output/event-type-stats-cache.json');
    const categoryDetailsCaches = [
      'event-category-issue-cache.json',
      'event-category-accountNotification-cache.json',
      'event-category-scheduledChange-cache.json',
      'event-category-investigation-cache.json'
    ];
    const eventTypeDetailsCaches = [
      'event-type-configuration-alerts-cache.json',
      'event-type-cost-impact-events-cache.json',
      'event-type-maintenance-updates-cache.json',
      'event-type-migration-requirements-cache.json',
      'event-type-operational-notifications-cache.json',
      'event-type-security-compliance-cache.json'
    ];
    
    if (fs.existsSync(eventCategoriesCache)) {
      fs.unlinkSync(eventCategoriesCache);
    }
    if (fs.existsSync(eventTypeStatsCache)) {
      fs.unlinkSync(eventTypeStatsCache);
    }
    
    categoryDetailsCaches.forEach(cacheFile => {
      const filePath = path.join(__dirname, '../output', cacheFile);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    
    eventTypeDetailsCaches.forEach(cacheFile => {
      const filePath = path.join(__dirname, '../output', cacheFile);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    
    // Generate fresh data
    const [eventCategoriesData, eventTypeStatsData] = await Promise.all([
      generateEventCategoriesData(),
      generateEventTypeStatsData()
    ]);
    
    // Generate all category details caches
    const scanAllPages = async (params) => {
      let allItems = [];
      let lastEvaluatedKey = null;
      
      do {
        const scanParams = { ...params };
        if (lastEvaluatedKey) {
          scanParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.scan(scanParams).promise();
        const pageItems = result.Items || [];
        allItems = allItems.concat(pageItems);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      return allItems;
    };
    
    const categories = ['issue', 'accountNotification', 'scheduledChange', 'investigation'];
    const categoryDetailsPromises = categories.map(async (category) => {
      const params = {
        TableName: 'chaplin-health-events',
        FilterExpression: 'eventCategory = :category',
        ExpressionAttributeValues: {
          ':category': category
        }
      };
      
      const events = await scanAllPages(params);
      const cacheData = {
        data: events,
        lastUpdated: new Date().toISOString()
      };
      
      const fileName = `event-category-${category}-cache.json`;
      fs.writeFileSync(path.join(__dirname, '../output', fileName), JSON.stringify(cacheData, null, 2));
      return { category, count: events.length };
    });
    
    await Promise.all(categoryDetailsPromises);
    
    // Generate all event type details caches
    const eventTypes = ['configuration-alerts', 'cost-impact-events', 'maintenance-updates', 'migration-requirements', 'operational-notifications', 'security-compliance'];
    const patterns = {
      'configuration-alerts': [/.*_HIGH_RISK_CONFIG.*/, /.*_PERSISTENCE_EXPIRING$/, /.*_RENEWAL_STATE_CHANGE$/, /.*_CUSTOMER_ENGAGEMENT$/, /.*_RUNAWAY_TERMINATION.*/],
      'cost-impact-events': [/AWS_BILLING_NOTIFICATION$/, /.*_ODCR_.*/, /.*_SUBSCRIPTION_RENEWAL.*/, /.*_CAPACITY_.*/, /.*_UNDERUTILIZATION.*/],
      'maintenance-updates': [/.*_MAINTENANCE_SCHEDULED$/, /.*_MAINTENANCE_COMPLETE$/, /.*_MAINTENANCE_EXTENSION$/, /.*_UPDATE_AVAILABLE$/, /.*_UPDATE_COMPLETED$/, /.*_AUTO_UPGRADE_NOTIFICATION$/, /.*_UPCOMING_MAINTENANCE$/],
      'migration-requirements': [/.*_PLANNED_LIFECYCLE_EVENT$/, /.*_PERSISTENT_INSTANCE_RETIREMENT_SCHEDULED$/, /.*_TASK_PATCHING_RETIREMENT$/, /.*_VM_DEPRECATED$/],
      'operational-notifications': [/.*_OPERATIONAL_NOTIFICATION$/, /.*_OPERATIONAL_ISSUE$/, /.*_SERVICE_ISSUE$/, /.*_CLUSTER_HEALTH_ISSUES$/, /.*_POD_EVICTIONS$/, /.*_REDUNDANCY_LOSS$/, /.*_TUNNEL_NOTIFICATION$/, /.*_EXPERIMENT_EVENT$/],
      'security-compliance': [/.*_SECURITY_NOTIFICATION$/, /.*_SECURITY_PATCHING_EVENT$/]
    };
    
    const allEventsParams = { TableName: 'chaplin-health-events' };
    const allEvents = await scanAllPages(allEventsParams);
    
    const eventTypeDetailsPromises = eventTypes.map(async (eventType) => {
      const eventPatterns = patterns[eventType];
      const filteredEvents = allEvents.filter(event => {
        const eventTypeField = event.event_type || '';
        return eventPatterns.some(pattern => pattern.test(eventTypeField));
      });
      
      const cacheData = {
        data: filteredEvents,
        lastUpdated: new Date().toISOString()
      };
      
      const fileName = `event-type-${eventType}-cache.json`;
      fs.writeFileSync(path.join(__dirname, '../output', fileName), JSON.stringify(cacheData, null, 2));
      return { eventType, count: filteredEvents.length };
    });
    
    await Promise.all(eventTypeDetailsPromises);
    
    // Save main caches
    fs.writeFileSync(eventCategoriesCache, JSON.stringify(eventCategoriesData, null, 2));
    fs.writeFileSync(eventTypeStatsCache, JSON.stringify(eventTypeStatsData, null, 2));
    
    res.json({ 
      success: true, 
      message: 'Cache refreshed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing cache:', error);
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
});

// Fallback non-streaming endpoint (with longer timeout)
// Critical events endpoints
app.get('/api/critical-events-count', requireAuth, async (req, res) => {
  try {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const params = {
      TableName: 'chaplin-health-events',
      FilterExpression: '#start_time BETWEEN :now AND :thirtyDays AND contains(#event_type_code, :critical)',
      ExpressionAttributeNames: {
        '#start_time': 'start_time',
        '#event_type_code': 'event_type_code'
      },
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':thirtyDays': thirtyDaysFromNow.toISOString(),
        ':critical': 'critical'
      }
    };
    
    const result = await dynamodb.scan(params).promise();
    res.json({ count: result.Items.length });
  } catch (error) {
    console.error('Error fetching critical events count:', error);
    res.status(500).json({ error: 'Failed to fetch critical events count' });
  }
});

app.get('/api/critical-events-analysis-cached', (req, res) => {
  try {
    const cacheFile = path.join(__dirname, '../output/critical-events-cache.json');
    
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const now = new Date();
      const cacheTime = new Date(cacheData.timestamp);
      const ttlHours = cacheData.ttl_hours || 1;
      const ageHours = (now - cacheTime) / (1000 * 60 * 60);
      
      if (ageHours < ttlHours) {
        return res.json({
          success: true,
          output: cacheData.analysis,
          cached: true,
          lastRefreshed: cacheData.timestamp,
          ttlHours: ttlHours
        });
      }
    }
    
    // Cache expired or doesn't exist, trigger fresh analysis
    res.json({ success: false, needsRefresh: true });
  } catch (error) {
    console.error('Error reading cache:', error);
    res.json({ success: false, needsRefresh: true });
  }
});

app.post('/api/critical-events-analysis-refresh', requireAuth, (req, res) => {
  try {
    const { prompt } = req.body;
    
    // DEBUG: Log the incoming request
    console.log('DEBUG - Incoming request:', {
      hasPrompt: !!prompt,
      promptType: typeof prompt,
      promptLength: prompt ? prompt.length : 0,
      promptPreview: prompt ? prompt.substring(0, 100) + '...' : 'undefined'
    });
    
    // DEBUG: Log character codes to identify invalid characters
    if (prompt) {
      const invalidChars = [];
      for (let i = 0; i < prompt.length; i++) {
        const char = prompt[i];
        const code = char.charCodeAt(0);
        if (!/^[a-zA-Z0-9\s.,!?;:()\-'"@#%&*+=\[\]{}\/\\`\n\r]+$/.test(char)) {
          invalidChars.push({ char, code, position: i });
        }
      }
      if (invalidChars.length > 0) {
        console.log('DEBUG - Invalid characters found:', invalidChars.slice(0, 10));
      }
    }
    
    // SECURITY: Validate and sanitize input
    const validation = validateAndSanitizePrompt(prompt);
    if (!validation.valid) {
      console.log('DEBUG - Validation failed:', validation.error);
      return res.status(400).json({ 
        error: validation.error,
        success: false 
      });
    }
    
    // LOG REQUEST for audit trail
    console.log({
      timestamp: new Date().toISOString(),
      endpoint: '/api/critical-events-analysis-refresh',
      user: req.session.user?.username,
      promptLength: validation.sanitized.length,
      ip: req.ip
    });
    
    let responseSent = false;
    
    // Use sanitized prompt
    const pythonProcess = spawn(PYTHON_PATH, ['test_agentic_analysis.py', validation.sanitized], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PYTHONPATH: path.join(__dirname, '..') }
    });
    
    // SECURITY: Add timeout to prevent resource exhaustion
    const TIMEOUT = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        pythonProcess.kill('SIGTERM');
        responseSent = true;
        res.status(504).json({ error: 'Analysis timeout', success: false });
      }
    }, TIMEOUT);
    
    let output = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutId); // SECURITY: Clear timeout when process completes
      if (!responseSent) {
        responseSent = true;
        if (code === 0) {
          // Extract HTML content from ```html``` code blocks or <html> tags
          let htmlContent = '';
          
          // First try to extract from ```html``` code blocks
          const codeBlockMatch = output.match(/```html\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            htmlContent = codeBlockMatch[1].trim();
          } else {
            // Fallback to <html> tags
            const htmlMatch = output.match(/<html[\s\S]*?<\/html>/i);
            htmlContent = htmlMatch ? htmlMatch[0] : output;
          }
          
          // Cache only the HTML content
          const cacheFile = path.join(__dirname, '../output/critical-events-cache.json');
          
          // Preserve existing TTL if cache file exists
          let existingTtl = 1; // default
          if (fs.existsSync(cacheFile)) {
            try {
              const existingCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
              existingTtl = existingCache.ttl_hours || 1;
            } catch (e) {
              // Use default if can't read existing file
            }
          }
          
          const cacheData = {
            timestamp: new Date().toISOString(),
            ttl_hours: existingTtl,
            analysis: htmlContent,
            prompt: validation.sanitized // Use sanitized prompt
          };
          
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
          
          res.json({
            success: true,
            output: htmlContent,
            cached: false,
            lastRefreshed: cacheData.timestamp,
            ttlHours: cacheData.ttl_hours
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Agent analysis failed',
            stderr: error
          });
        }
      }
    });
    
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        pythonProcess.kill();
        res.status(408).json({ error: 'Agent analysis timeout' });
      }
    }, 60000);
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start analysis' });
    }
  }
});

// Critical Events 30-60 days endpoints
app.get('/api/critical-events-analysis-cached-60', (req, res) => {
  try {
    const cacheFile = path.join(__dirname, '../output/critical-events-cache-60.json');
    
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const now = new Date();
      const cacheTime = new Date(cacheData.timestamp);
      const ttlHours = cacheData.ttl_hours || 1;
      const ageHours = (now - cacheTime) / (1000 * 60 * 60);
      
      if (ageHours < ttlHours) {
        return res.json({
          success: true,
          output: cacheData.analysis,
          cached: true,
          lastRefreshed: cacheData.timestamp,
          ttlHours: ttlHours
        });
      }
    }
    
    // Cache expired or doesn't exist, trigger fresh analysis
    res.json({ success: false, needsRefresh: true });
  } catch (error) {
    console.error('Error reading 60-day cache:', error);
    res.json({ success: false, needsRefresh: true });
  }
});

app.post('/api/critical-events-analysis-refresh-60', requireAuth, (req, res) => {
  try {
    const { prompt } = req.body;
    
    // SECURITY: Validate and sanitize input
    const validation = validateAndSanitizePrompt(prompt);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        success: false 
      });
    }
    
    // LOG REQUEST for audit trail
    console.log({
      timestamp: new Date().toISOString(),
      endpoint: '/api/critical-events-analysis-refresh-60',
      user: req.session.user?.username,
      promptLength: validation.sanitized.length,
      ip: req.ip
    });
    
    let responseSent = false;
    
    // Use sanitized prompt
    const pythonProcess = spawn(PYTHON_PATH, ['test_agentic_analysis.py', validation.sanitized], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PYTHONPATH: path.join(__dirname, '..') }
    });
    
    // SECURITY: Add timeout to prevent resource exhaustion
    const TIMEOUT = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        pythonProcess.kill('SIGTERM');
        responseSent = true;
        res.status(504).json({ error: 'Analysis timeout', success: false });
      }
    }, TIMEOUT);
    
    let output = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutId); // SECURITY: Clear timeout when process completes
      if (!responseSent) {
        responseSent = true;
        if (code === 0) {
          // Extract HTML content from ```html``` code blocks or <html> tags
          let htmlContent = '';
          
          // First try to extract from ```html``` code blocks
          const codeBlockMatch = output.match(/```html\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            htmlContent = codeBlockMatch[1].trim();
          } else {
            // Fallback to <html> tags
            const htmlMatch = output.match(/<html[\s\S]*?<\/html>/i);
            htmlContent = htmlMatch ? htmlMatch[0] : output;
          }
          
          // Cache to separate 60-day file
          const cacheFile = path.join(__dirname, '../output/critical-events-cache-60.json');
          
          // Preserve existing TTL if cache file exists
          let existingTtl = 1; // default
          if (fs.existsSync(cacheFile)) {
            try {
              const existingCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
              existingTtl = existingCache.ttl_hours || 1;
            } catch (e) {
              // Use default if can't read existing file
            }
          }
          
          const cacheData = {
            timestamp: new Date().toISOString(),
            ttl_hours: existingTtl,
            analysis: htmlContent,
            prompt: validation.sanitized // Use sanitized prompt
          };
          
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
          
          res.json({
            success: true,
            output: htmlContent,
            cached: false,
            lastRefreshed: cacheData.timestamp,
            ttlHours: cacheData.ttl_hours
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Agent analysis failed',
            stderr: error
          });
        }
      }
    });
    
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        pythonProcess.kill();
        res.status(408).json({ error: 'Agent analysis timeout' });
      }
    }, 60000);
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start 60-day analysis' });
    }
  }
});

// Critical Events Past Due endpoints
app.get('/api/critical-events-analysis-cached-pastdue', (req, res) => {
  try {
    const cacheFile = path.join(__dirname, '../output/critical-events-pastdue.json');
    
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const now = new Date();
      const cacheTime = new Date(cacheData.timestamp);
      const ttlHours = cacheData.ttl_hours || 1;
      const ageHours = (now - cacheTime) / (1000 * 60 * 60);
      
      if (ageHours < ttlHours) {
        return res.json({
          success: true,
          output: cacheData.analysis,
          cached: true,
          lastRefreshed: cacheData.timestamp,
          ttlHours: ttlHours
        });
      }
    }
    
    // Cache expired or doesn't exist, trigger fresh analysis
    res.json({ success: false, needsRefresh: true });
  } catch (error) {
    console.error('Error reading past due cache:', error);
    res.json({ success: false, needsRefresh: true });
  }
});

app.post('/api/critical-events-analysis-refresh-pastdue', requireAuth, (req, res) => {
  try {
    const { prompt } = req.body;
    
    // SECURITY: Validate and sanitize input
    const validation = validateAndSanitizePrompt(prompt);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        success: false 
      });
    }
    
    // LOG REQUEST for audit trail
    console.log({
      timestamp: new Date().toISOString(),
      endpoint: '/api/critical-events-analysis-refresh-pastdue',
      user: req.session.user?.username,
      promptLength: validation.sanitized.length,
      ip: req.ip
    });
    
    let responseSent = false;
    
    // Use sanitized prompt
    const pythonProcess = spawn(PYTHON_PATH, ['test_agentic_analysis.py', validation.sanitized], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PYTHONPATH: path.join(__dirname, '..') }
    });
    
    // SECURITY: Add timeout to prevent resource exhaustion
    const TIMEOUT = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        pythonProcess.kill('SIGTERM');
        responseSent = true;
        res.status(504).json({ error: 'Analysis timeout', success: false });
      }
    }, TIMEOUT);
    
    let output = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutId); // SECURITY: Clear timeout when process completes
      if (!responseSent) {
        responseSent = true;
        if (code === 0) {
          // Extract HTML content from ```html``` code blocks or <html> tags
          let htmlContent = '';
          
          // First try to extract from ```html``` code blocks
          const codeBlockMatch = output.match(/```html\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            htmlContent = codeBlockMatch[1].trim();
          } else {
            // Fallback to <html> tags
            const htmlMatch = output.match(/<html[\s\S]*?<\/html>/i);
            htmlContent = htmlMatch ? htmlMatch[0] : output;
          }
          
          // Cache to separate past due file
          const cacheFile = path.join(__dirname, '../output/critical-events-pastdue.json');
          
          // Preserve existing TTL if cache file exists
          let existingTtl = 1; // default
          if (fs.existsSync(cacheFile)) {
            try {
              const existingCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
              existingTtl = existingCache.ttl_hours || 1;
            } catch (e) {
              // Use default if can't read existing file
            }
          }
          
          const cacheData = {
            timestamp: new Date().toISOString(),
            ttl_hours: existingTtl,
            analysis: htmlContent,
            prompt: validation.sanitized // Use sanitized prompt
          };
          
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
          
          res.json({
            success: true,
            output: htmlContent,
            cached: false,
            lastRefreshed: cacheData.timestamp,
            ttlHours: cacheData.ttl_hours
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Agent analysis failed',
            stderr: error
          });
        }
      }
    });
    
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        pythonProcess.kill();
        res.status(408).json({ error: 'Agent analysis timeout' });
      }
    }, 60000);
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start past due analysis' });
    }
  }
});

// Cached prompts endpoints
app.get('/api/cached-prompts', (req, res) => {
  try {
    const promptsFile = path.join(__dirname, '../output/cached-prompts.json');
    
    if (fs.existsSync(promptsFile)) {
      const data = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
      // Sort by usage count descending
      data.prompts.sort((a, b) => b.usage_count - a.usage_count);
      res.json(data);
    } else {
      res.json({ prompts: [] });
    }
  } catch (error) {
    console.error('Error fetching cached prompts:', error);
    res.status(500).json({ error: 'Failed to load cached prompts' });
  }
});

// Store last response for popup fallback
let lastAnalysisResponse = '';

// API endpoint to get last response
app.get('/api/get-last-response', (req, res) => {
  res.json({ response: lastAnalysisResponse });
});

// Streaming Agent Analysis Endpoint
app.post('/api/agent-analysis-stream', requireAuth, (req, res) => {
  try {
    const { prompt } = req.body;
    
    // SECURITY: Validate and sanitize input
    const validation = validateAndSanitizePrompt(prompt);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        success: false 
      });
    }
    
    // LOG REQUEST for audit trail
    console.log({
      timestamp: new Date().toISOString(),
      endpoint: '/api/agent-analysis-stream',
      user: req.session.user?.username,
      promptLength: validation.sanitized.length,
      ip: req.ip
    });
    
    console.log(`🤖 Starting agent analysis for prompt: ${validation.sanitized.substring(0, 100)}...`);
    
    // Send immediate response
    res.json({ success: true, message: 'Agent analysis started, results will stream via WebSocket' });
    
    // Broadcast start message immediately
    broadcast({ type: 'agent_started', message: '🤖 Initializing Cost Health Agent...' });
    
    // Add a small delay to ensure WebSocket connection is established
    setTimeout(() => {
      broadcast({ type: 'agent_progress', message: '🔧 Loading cache data...', timestamp: new Date().toISOString() });
      
      // Update cached prompts
      const promptsFile = path.join(__dirname, '../output/cached-prompts.json');
      let promptsData = { prompts: [] };
      
      if (fs.existsSync(promptsFile)) {
        promptsData = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
      }
      
      // Check for duplicate prompts (use sanitized prompt)
      const existingPrompt = promptsData.prompts.find(p => p.text.toLowerCase() === validation.sanitized.toLowerCase());
      
      if (existingPrompt) {
        existingPrompt.usage_count += 1;
        existingPrompt.last_used = new Date().toISOString();
      } else {
        const newPrompt = {
          id: (promptsData.prompts.length + 1).toString(),
          text: validation.sanitized,
          usage_count: 1,
          last_used: new Date().toISOString(),
          category: 'user-generated'
        };
        promptsData.prompts.push(newPrompt);
      }
      
      promptsData.prompts.sort((a, b) => b.usage_count - a.usage_count);
      fs.writeFileSync(promptsFile, JSON.stringify(promptsData, null, 2));
      
      broadcast({ type: 'agent_progress', message: '📝 Starting Python agent process...', timestamp: new Date().toISOString() });
      
      // Run the agentic analysis agent with sanitized prompt
      const pythonProcess = spawn(PYTHON_PATH, ['test_agentic_analysis.py', validation.sanitized], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PYTHONPATH: path.join(__dirname, '..') }
      });
      
      // SECURITY: Add timeout to prevent resource exhaustion
      const TIMEOUT = 60000; // 60 seconds
      const timeoutId = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        broadcast({ type: 'error', message: 'Analysis timeout', timestamp: new Date().toISOString() });
      }, TIMEOUT);
      
      let responseBuffer = '';
      let hasOutput = false;
      
      pythonProcess.stdout.on('data', (data) => {
        hasOutput = true;
        const output = data.toString();
        responseBuffer += output;
        console.log('Python stdout chunk length:', output.length);
        console.log('Python stdout chunk preview:', output.substring(0, 100));
        
        // Only send "Analyzing..." message, not intermediate logs
        if (output.includes('Processing user query:')) {
          broadcast({ 
            type: 'agent_progress', 
            message: '🔍 Analyzing...',
            timestamp: new Date().toISOString()
          });
        }
      });
      
      pythonProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.error('Python stderr:', error);
        
        // Filter out INFO logs, only send actual errors
        if (!error.includes('INFO') && !error.includes('Found credentials')) {
          // Don't disconnect WebSocket for database validation errors - let recovery continue
          if (error.includes('ValidationException') || error.includes('DynamoDB query failed')) {
            console.log('🔧 Database validation error detected - maintaining WebSocket connection for recovery');
            broadcast({ 
              type: 'agent_progress', 
              message: '🔧 Correcting database query...',
              timestamp: new Date().toISOString()
            });
          } else if (error.includes('throttling') || error.includes('ThrottlingException') || error.includes('rate limit')) {
            broadcast({ 
              type: 'throttling_error', 
              message: `⚠️ Rate limiting detected. Please wait a moment and try again. The system is temporarily throttled to prevent overload.`,
              timestamp: new Date().toISOString()
            });
          } else {
            broadcast({ 
              type: 'agent_error', 
              message: `Error: ${error.trim()}`,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      
      pythonProcess.on('close', (code) => {
        clearTimeout(timeoutId); // SECURITY: Clear timeout when process completes
        console.log(`Python process exited with code: ${code}`);
        
        if (code === 0 && hasOutput) {
          // Extract complete HTML response from <html> to </html>
          let finalResponse = '';
          
          // Look for HTML content more broadly
          const htmlStartPattern = /<html[^>]*>/i;
          const htmlEndPattern = /<\/html>/i;
          
          const htmlStartMatch = responseBuffer.match(htmlStartPattern);
          const htmlEndMatch = responseBuffer.match(htmlEndPattern);
          
          if (htmlStartMatch && htmlEndMatch) {
            const htmlStart = responseBuffer.indexOf(htmlStartMatch[0]);
            const htmlEnd = responseBuffer.lastIndexOf(htmlEndMatch[0]) + htmlEndMatch[0].length;
            finalResponse = responseBuffer.substring(htmlStart, htmlEnd).trim();
          } else {
            // Fallback: look for any HTML-like content
            const htmlPattern = /<[^>]+>/;
            if (htmlPattern.test(responseBuffer)) {
              // Extract everything from first HTML tag to last
              const lines = responseBuffer.split('\n');
              let startIdx = -1, endIdx = -1;
              
              for (let i = 0; i < lines.length; i++) {
                if (htmlPattern.test(lines[i]) && startIdx === -1) {
                  startIdx = i;
                }
                if (htmlPattern.test(lines[i])) {
                  endIdx = i;
                }
              }
              
              if (startIdx !== -1 && endIdx !== -1) {
                finalResponse = lines.slice(startIdx, endIdx + 1).join('\n').trim();
              }
            }
          }
          
          // If still no HTML found, use substantial content
          if (!finalResponse) {
            const lines = responseBuffer.split('\n');
            const substantialLines = lines.filter(line => 
              line.trim().length > 50 && 
              !line.includes('INFO:') && 
              !line.includes('ERROR:') &&
              !line.includes('🔍 Analyzing')
            );
            finalResponse = substantialLines.join('\n').trim();
          }
          
          if (!finalResponse) {
            finalResponse = responseBuffer.trim() || 'Analysis completed but no output was captured.';
          }
          
          console.log('🔍 Final response length:', finalResponse.length);
          console.log('🔍 Final response preview:', finalResponse.substring(0, 200));
          
          // Check for duplicate HTML content and clean it up
          const htmlDocPattern = /<html[^>]*>[\s\S]*?<\/html>/gi;
          const htmlMatches = finalResponse.match(htmlDocPattern);
          
          if (htmlMatches && htmlMatches.length > 1) {
            console.log(`⚠️ Found ${htmlMatches.length} HTML documents in response - using the last one`);
            finalResponse = htmlMatches[htmlMatches.length - 1].trim();
            console.log('🔧 Cleaned response length:', finalResponse.length);
          }
          
          // Additional check for repeated table content
          const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
          const tableMatches = finalResponse.match(tablePattern);
          
          if (tableMatches && tableMatches.length > 1) {
            // Check if tables are identical
            const uniqueTables = [...new Set(tableMatches)];
            if (uniqueTables.length < tableMatches.length) {
              console.log(`⚠️ Found ${tableMatches.length} tables, ${uniqueTables.length} unique - removing duplicates`);
              // Replace all tables with just the unique ones
              let cleanedResponse = finalResponse;
              tableMatches.forEach((table, index) => {
                if (index > 0 && uniqueTables.includes(table)) {
                  cleanedResponse = cleanedResponse.replace(table, '');
                }
              });
              finalResponse = cleanedResponse.trim();
              console.log('🔧 After table deduplication length:', finalResponse.length);
            }
          }
          
          // Store response for popup fallback
          lastAnalysisResponse = finalResponse;
          
          broadcast({ 
            type: 'agent_output', 
            message: finalResponse,
            timestamp: new Date().toISOString()
          });
        } else if (code === 1 && hasOutput) {
          // Python exited with error but produced HTML output
          let errorResponse = '';
          
          const htmlStartPattern = /<html[^>]*>/i;
          const htmlEndPattern = /<\/html>/i;
          
          const htmlStartMatch = responseBuffer.match(htmlStartPattern);
          const htmlEndMatch = responseBuffer.match(htmlEndPattern);
          
          if (htmlStartMatch && htmlEndMatch) {
            const htmlStart = responseBuffer.indexOf(htmlStartMatch[0]);
            const htmlEnd = responseBuffer.lastIndexOf(htmlEndMatch[0]) + htmlEndMatch[0].length;
            errorResponse = responseBuffer.substring(htmlStart, htmlEnd).trim();
          }
          
          if (errorResponse) {
            broadcast({ 
              type: 'agent_output', 
              message: errorResponse,
              timestamp: new Date().toISOString()
            });
          } else {
            broadcast({ 
              type: 'agent_failed', 
              message: 'Analysis failed. Please try again.',
              timestamp: new Date().toISOString()
            });
          }
        } else if (code === 0 && !hasOutput) {
          broadcast({ 
            type: 'agent_output', 
            message: 'Analysis completed but no output was generated. Please check if the cache file exists and contains data.',
            timestamp: new Date().toISOString()
          });
        } else if (code === null) {
          // Handle hanging process
          broadcast({ 
            type: 'agent_failed', 
            message: 'Analysis process was terminated due to timeout or system error. Please try again.',
            timestamp: new Date().toISOString()
          });
        } else {
          // Check if this was a throttling error and provide helpful message
          const errorOutput = responseBuffer;
          if (errorOutput.includes('throttling') || errorOutput.includes('ThrottlingException') || errorOutput.includes('rate limit')) {
            broadcast({ 
              type: 'agent_output', 
              message: `<h3>⚠️ Rate Limiting Detected</h3>
              <p>The AWS API is currently rate limiting requests. This is a temporary condition that helps prevent system overload.</p>
              <p><strong>What you can do:</strong></p>
              <ul>
                <li>Wait 30-60 seconds and try your query again</li>
                <li>Try a more specific query to reduce data processing</li>
                <li>Use cached prompts from the dropdown for faster responses</li>
              </ul>
              <p>Your query "${prompt}" has been saved and you can retry it shortly.</p>`,
              timestamp: new Date().toISOString()
            });
          } else {
            broadcast({ 
              type: 'agent_failed', 
              message: `Agent analysis failed with exit code: ${code}. Please try again or contact support if the issue persists.`,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      
      pythonProcess.on('error', (error) => {
        console.error('Python process error:', error);
        broadcast({ 
          type: 'agent_error', 
          message: `Process error: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      });
      
      // Set timeout for the process
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          broadcast({ 
            type: 'agent_failed', 
            message: 'Agent analysis timed out after 60 seconds',
            timestamp: new Date().toISOString()
          });
        }
      }, 60000);
      
    }, 100); // Small delay to ensure WebSocket is ready
    
  } catch (error) {
    console.error('Error starting agent analysis:', error);
    broadcast({ 
      type: 'agent_error', 
      message: `Failed to start agent analysis: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// Non-streaming fallback endpoint
app.post('/api/agent-analysis', requireAuth, (req, res) => {
  try {
    const { prompt } = req.body;
    
    // SECURITY: Validate and sanitize input
    const validation = validateAndSanitizePrompt(prompt);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        success: false 
      });
    }
    
    // LOG REQUEST for audit trail
    console.log({
      timestamp: new Date().toISOString(),
      endpoint: '/api/agent-analysis',
      user: req.session.user?.username,
      promptLength: validation.sanitized.length,
      ip: req.ip
    });
    
    // Update cached prompts (use sanitized prompt)
    const promptsFile = path.join(__dirname, '../output/cached-prompts.json');
    let promptsData = { prompts: [] };
    
    if (fs.existsSync(promptsFile)) {
      promptsData = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
    }
    
    const existingPrompt = promptsData.prompts.find(p => p.text.toLowerCase() === validation.sanitized.toLowerCase());
    
    if (existingPrompt) {
      existingPrompt.usage_count += 1;
      existingPrompt.last_used = new Date().toISOString();
    } else {
      const newPrompt = {
        id: (promptsData.prompts.length + 1).toString(),
        text: validation.sanitized,
        usage_count: 1,
        last_used: new Date().toISOString(),
        category: 'user-generated'
      };
      promptsData.prompts.push(newPrompt);
    }
    
    promptsData.prompts.sort((a, b) => b.usage_count - a.usage_count);
    fs.writeFileSync(promptsFile, JSON.stringify(promptsData, null, 2));
    
    // Run the agentic analysis agent synchronously with sanitized prompt
    let responseSent = false;
    const pythonProcess = spawn(PYTHON_PATH, ['test_agentic_analysis.py', validation.sanitized], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PYTHONPATH: path.join(__dirname, '..') }
    });
    
    // SECURITY: Add timeout to prevent resource exhaustion
    const TIMEOUT = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        pythonProcess.kill('SIGTERM');
        responseSent = true;
        res.status(504).json({ error: 'Analysis timeout', success: false });
      }
    }, TIMEOUT);
    
    let output = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutId); // SECURITY: Clear timeout when process completes
      if (!responseSent) {
        responseSent = true;
        if (code === 0) {
          res.json({
            success: true,
            analysis: output,
            prompt: validation.sanitized // Use sanitized prompt
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Agent analysis failed',
            stderr: error
          });
        }
      }
    });
    
    // Note: Timeout is now handled by timeoutId above
  } catch (error) {
    console.error('Error processing agent analysis:', error);
    res.status(500).json({ error: 'Failed to process agent analysis' });
  }
});

// Drill-down details endpoint
app.get('/api/drill-down-details', requireAuth, async (req, res) => {
  try {
    const { filters } = req.query;
    
    if (!filters) {
      return res.status(400).json({ 
        error: 'Filters parameter is required',
        message: 'Please provide filters parameter with drill-down criteria'
      });
    }
    
    let parsedFilters;
    try {
      const decodedFilters = decodeURIComponent(filters);
      parsedFilters = JSON.parse(decodedFilters);
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid filters format',
        message: 'Filters must be valid JSON format',
        received: filters
      });
    }
    
    // Validate that we have at least one filter
    const validFilters = ['account', 'region', 'eventCategory', 'service', 'status_code', 'event_type', 'start_time', 'arn'];
    const hasValidFilter = validFilters.some(key => parsedFilters[key]);
    
    if (!hasValidFilter) {
      return res.status(400).json({
        error: 'No valid filters provided',
        message: 'At least one of the following filters is required: account, region, eventCategory, service, status_code, event_type, start_time, arn',
        validFilters: validFilters
      });
    }
    
    // Log the received filters for debugging
    console.log('🔍 Drill-down filters received:', JSON.stringify(parsedFilters, null, 2));
    console.log('🔍 Filter validation - hasValidFilter:', hasValidFilter);
    console.log('🔍 Valid filter keys found:', Object.keys(parsedFilters).filter(key => validFilters.includes(key)));
    
    // Build DynamoDB scan parameters based on filters
    const scanParams = {
      TableName: 'chaplin-health-events'
    };
    
    const filterExpressions = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};
    
    // Add filters based on provided criteria with improved validation
    if (parsedFilters.account && parsedFilters.account !== 'undefined' && parsedFilters.account !== '') {
      filterExpressions.push('#account = :account');
      expressionAttributeNames['#account'] = 'account';
      expressionAttributeValues[':account'] = parsedFilters.account;
    }
    
    if (parsedFilters.region && parsedFilters.region !== 'undefined' && parsedFilters.region !== '') {
      filterExpressions.push('#region = :region');
      expressionAttributeNames['#region'] = 'region';
      expressionAttributeValues[':region'] = parsedFilters.region;
    }
    
    if (parsedFilters.eventCategory) {
      // Map frontend category names to database category names
      let mappedCategory = parsedFilters.eventCategory;
      if (parsedFilters.eventCategory === 'plannedChange') {
        mappedCategory = 'scheduledChange';
      }
      
      // Check if this looks like a specific event type (contains underscores and is long)
      if (mappedCategory.includes('_') && mappedCategory.length > 20) {
        filterExpressions.push('event_type = :event_type');
        expressionAttributeValues[':event_type'] = mappedCategory;
      } else if (mappedCategory === 'PLANNED_LIFECYCLE_EVENT') {
        if (parsedFilters.service) {
          const fullEventType = `AWS_${parsedFilters.service}_PLANNED_LIFECYCLE_EVENT`;
          filterExpressions.push('event_type = :event_type');
          expressionAttributeValues[':event_type'] = fullEventType;
        } else {
          filterExpressions.push('contains(event_type, :event_type_pattern)');
          expressionAttributeValues[':event_type_pattern'] = 'PLANNED_LIFECYCLE_EVENT';
        }
      } else {
        filterExpressions.push('eventCategory = :eventCategory');
        expressionAttributeValues[':eventCategory'] = mappedCategory;
      }
    }
    
    if (parsedFilters.service && parsedFilters.service !== 'undefined' && parsedFilters.service !== '') {
      filterExpressions.push('#service = :service');
      expressionAttributeNames['#service'] = 'service';
      expressionAttributeValues[':service'] = parsedFilters.service;
    }
    
    if (parsedFilters.status_code && parsedFilters.status_code !== 'undefined' && parsedFilters.status_code !== '') {
      filterExpressions.push('status_code = :status_code');
      expressionAttributeValues[':status_code'] = parsedFilters.status_code;
    }
    
    // Add support for event_type filter
    if (parsedFilters.event_type && parsedFilters.event_type !== 'undefined' && parsedFilters.event_type !== '') {
      filterExpressions.push('event_type = :event_type');
      expressionAttributeValues[':event_type'] = parsedFilters.event_type;
    }
    
    // Add support for start_time filter
    if (parsedFilters.start_time && parsedFilters.start_time !== 'undefined' && parsedFilters.start_time !== '') {
      filterExpressions.push('start_time = :start_time');
      expressionAttributeValues[':start_time'] = parsedFilters.start_time;
    }
    
    // Add support for arn filter (most specific)
    if (parsedFilters.arn && parsedFilters.arn !== 'undefined' && parsedFilters.arn !== '') {
      filterExpressions.push('arn = :arn');
      expressionAttributeValues[':arn'] = parsedFilters.arn;
    }
    
    if (filterExpressions.length > 0) {
      scanParams.FilterExpression = filterExpressions.join(' AND ');
      scanParams.ExpressionAttributeValues = expressionAttributeValues;
      
      if (Object.keys(expressionAttributeNames).length > 0) {
        scanParams.ExpressionAttributeNames = expressionAttributeNames;
      }
    }
    
    // Scan all pages to get complete results
    const scanAllPages = async (params) => {
      let allItems = [];
      let lastEvaluatedKey = null;
      
      do {
        const scanParamsWithKey = { ...params };
        if (lastEvaluatedKey) {
          scanParamsWithKey.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.scan(scanParamsWithKey).promise();
        const pageItems = result.Items || [];
        allItems = allItems.concat(pageItems);
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      return allItems;
    };
    
    const events = await scanAllPages(scanParams);
    
    // Log query execution details
    console.log(`🔍 Drill-down query executed:`, {
      filterExpression: scanParams.FilterExpression,
      attributeValues: scanParams.ExpressionAttributeValues,
      attributeNames: scanParams.ExpressionAttributeNames,
      resultCount: events.length
    });
    
    // Sort events by Account, Service, eventCategory, Start_time
    events.sort((a, b) => {
      // Sort by Account
      const accountA = a.account || '';
      const accountB = b.account || '';
      if (accountA !== accountB) {
        return accountA.localeCompare(accountB);
      }
      
      // Sort by Service
      const serviceA = a.service || '';
      const serviceB = b.service || '';
      if (serviceA !== serviceB) {
        return serviceA.localeCompare(serviceB);
      }
      
      // Sort by eventCategory
      const categoryA = a.eventCategory || '';
      const categoryB = b.eventCategory || '';
      if (categoryA !== categoryB) {
        return categoryA.localeCompare(categoryB);
      }
      
      // Sort by Start_time
      const startTimeA = a.start_time || '';
      const startTimeB = b.start_time || '';
      return startTimeA.localeCompare(startTimeB);
    });
    
    res.json({
      success: true,
      events: events,
      count: events.length,
      filters: parsedFilters,
      queryInfo: {
        filterExpression: scanParams.FilterExpression || 'No filters applied',
        appliedFilters: Object.keys(parsedFilters).filter(key => 
          parsedFilters[key] && parsedFilters[key] !== 'undefined' && parsedFilters[key] !== ''
        )
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in drill-down details:', error);
    res.status(500).json({ 
      error: 'Failed to fetch drill-down details',
      message: error.message 
    });
  }
});

// Debug endpoint to check S3 events with open status
app.get('/api/debug-s3-open', requireAuth, async (req, res) => {
  try {
    const scanParams = {
      TableName: 'chaplin-health-events',
      FilterExpression: '#service = :service AND status_code = :status_code',
      ExpressionAttributeNames: {
        '#service': 'service'
      },
      ExpressionAttributeValues: {
        ':service': 'S3',
        ':status_code': 'open'
      }
    };
    
    const result = await dynamodb.scan(scanParams).promise();
    const events = result.Items || [];
    
    console.log(`🔍 Debug S3 open events found: ${events.length}`);
    events.forEach((event, index) => {
      console.log(`Event ${index + 1}:`, {
        service: event.service,
        status_code: event.status_code,
        eventCategory: event.eventCategory,
        event_type_category: event.event_type_category,
        event_type: event.event_type
      });
    });
    
    res.json({
      success: true,
      count: events.length,
      events: events.map(event => ({
        service: event.service,
        status_code: event.status_code,
        eventCategory: event.eventCategory,
        event_type_category: event.event_type_category,
        event_type: event.event_type,
        arn: event.arn,
        region: event.region
      }))
    });
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Signup page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

// Root route - check auth and redirect
app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
});

// Serve unprotected static assets first
app.use('/static', express.static(path.join(__dirname, 'client/build/static')));
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/public/favicon.ico'));
});
app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/public/manifest.json'));
});
app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/public/robots.txt'));
});

// Serve React app (protected)
app.get('*', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 AWS Health Dashboard server running on port ${PORT}`);
  console.log(`🤖 Multi-agent orchestration available at /api/multi-agent-analysis`);
  console.log(`📡 WebSocket streaming available for real-time updates`);
  console.log(`🔍 Drill-down details available at /api/drill-down-details`);
});
