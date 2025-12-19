import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

function App() {
  const [categories, setCategories] = useState([]);
  const [eventCategories, setEventCategories] = useState([]);
  const [eventTypeStats, setEventTypeStats] = useState({});
  const [eventTypeLoading, setEventTypeLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [eventCategoriesLastRefreshed, setEventCategoriesLastRefreshed] = useState(null);
  const [eventTypeStatsLastRefreshed, setEventTypeStatsLastRefreshed] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedEventCategory, setSelectedEventCategory] = useState(null);
  const [selectedEventType, setSelectedEventType] = useState(null);
  const [categoryDetails, setCategoryDetails] = useState(null);
  const [activeTab, setActiveTab] = useState('services');
  const [initialLoading, setInitialLoading] = useState(true);
  const [showAgenticDiagnostics, setShowAgenticDiagnostics] = useState(false);
  const [previousView, setPreviousView] = useState(null); // Track where user came from
  const [analysisResults, setAnalysisResults] = useState([]);
  const [criticalEvents, setCriticalEvents] = useState({ count: 0, loading: true });
  const [showCriticalEventsDetail, setShowCriticalEventsDetail] = useState(false);
  const [showCriticalEvents30to60Detail, setShowCriticalEvents30to60Detail] = useState(false);
  const [showCriticalEventsPastDueDetail, setShowCriticalEventsPastDueDetail] = useState(false);
  const [criticalEventsAnalysis, setCriticalEventsAnalysis] = useState(null);
  const [criticalEvents30to60Analysis, setCriticalEvents30to60Analysis] = useState(null);
  const [criticalEventsPastDueAnalysis, setCriticalEventsPastDueAnalysis] = useState(null);
  const [showDrillDownDetail, setShowDrillDownDetail] = useState(false);
  const [drillDownData, setDrillDownData] = useState(null);

  const handleDrillDown = useCallback(async (filtersParam) => {
    try {
      // Track where user came from before closing views
      if (showAgenticDiagnostics) {
        setPreviousView('agentic');
      } else {
        setPreviousView('dashboard');
      }
      
      // Close other views to ensure drill-down view is shown
      setShowAgenticDiagnostics(false);
      setShowCriticalEventsDetail(false);
      setShowCriticalEvents30to60Detail(false);
      setShowCriticalEventsPastDueDetail(false);
      
      setShowDrillDownDetail(true);
      setDrillDownData({ loading: true });
      
      const response = await fetch(`/api/drill-down-details?filters=${encodeURIComponent(filtersParam)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setDrillDownData({
          events: data.events,
          count: data.count,
          filters: data.filters,
          timestamp: data.timestamp,
          loading: false
        });
      } else {
        setDrillDownData({
          error: data.message || data.error || 'Failed to load drill-down details',
          details: data,
          loading: false
        });
      }
    } catch (error) {
      setDrillDownData({
        error: `Network error: ${error.message}`,
        loading: false
      });
    }
  }, [showAgenticDiagnostics]);

  useEffect(() => {
    fetchCategories();
    fetchEventCategories();
    fetchEventTypeStats();
    fetchCriticalEvents();
    
    // Handle drill-down links from agentic analysis
    const handleDrillDownClick = (event) => {
      console.log('🖱️ GLOBAL CLICK detected on:', event.target);
      console.log('🔗 Target href:', event.target.href);
      console.log('🔗 Target text:', event.target.textContent);
      console.log('🔗 Target tagName:', event.target.tagName);
      console.log('🔗 Target className:', event.target.className);
      
      // Check for various drill-down link patterns
      const isDrillDownLink = event.target.matches('a[href*="/drill-down"]') || 
                             event.target.matches('a[href*="drill-down"]') ||
                             (event.target.textContent && event.target.textContent.includes('View Details')) ||
                             (event.target.textContent && event.target.textContent.includes('drill-down')) ||
                             // Also check parent elements for "View Details" text
                             (event.target.parentElement && event.target.parentElement.textContent && event.target.parentElement.textContent.includes('View Details'));
      
      console.log('🎯 Is drill-down link?', isDrillDownLink);
      
      if (isDrillDownLink) {
        console.log('✅ Drill-down link clicked!');
        event.preventDefault();
        
        if (event.target.href) {
          try {
            const url = new URL(event.target.href, window.location.origin);
            const filters = url.searchParams.get('filters');
            
            console.log('🔍 Extracted filters:', filters);
            
            if (filters) {
              handleDrillDown(filters);
            } else {
              console.warn('⚠️ No filters found in URL:', event.target.href);
            }
          } catch (error) {
            console.error('❌ Error parsing drill-down URL:', error);
          }
        } else {
          // Try to extract filters from onclick or data attributes
          const onclick = event.target.getAttribute('onclick');
          const dataFilters = event.target.getAttribute('data-filters');
          
          console.log('🔍 Checking onclick:', onclick);
          console.log('🔍 Checking data-filters:', dataFilters);
          
          if (dataFilters) {
            handleDrillDown(dataFilters);
          } else if (onclick && onclick.includes('drill-down')) {
            // Try to extract filters from onclick
            const match = onclick.match(/filters=([^&"']+)/);
            if (match) {
              const filters = decodeURIComponent(match[1]);
              console.log('🔍 Extracted filters from onclick:', filters);
              handleDrillDown(filters);
            }
          } else if (event.target.textContent && event.target.textContent.includes('View Details')) {
            // For "View Details" links without proper URLs, try to extract context from the table row
            
            // Find the parent table row - try multiple approaches
            let tableRow = event.target.closest('tr');
            if (!tableRow) {
              tableRow = event.target.closest('div[class*="table-row"], div[class*="row"]');
            }
            if (!tableRow) {
              const parentTd = event.target.closest('td');
              if (parentTd) {
                tableRow = parentTd.closest('tr');
              }
            }
            if (!tableRow) {
              let parent = event.target.parentElement;
              while (parent && parent !== document.body) {
                const textContent = parent.textContent;
                if (textContent && textContent.includes('EC2') && textContent.includes('View Details')) {
                  tableRow = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            }
            
            if (tableRow) {
              console.log('🔍 Found table row:', tableRow);
              console.log('🔍 Table row HTML:', tableRow.outerHTML.substring(0, 300));
              
              // Try to extract service and event type from the row
              const cells = tableRow.querySelectorAll('td, div[class*="col-"], th');
              const rowText = tableRow.textContent;
              
              let service = '';
              let eventCategory = '';
              let status = '';
              
              // Enhanced service name mapping - map display names to database values
              const serviceMapping = {
                'EC2': ['EC2', 'Amazon Elastic Compute Cloud', 'Elastic Compute Cloud'],
                'S3': ['S3', 'Amazon Simple Storage Service', 'Simple Storage Service'],
                'RDS': ['RDS', 'Amazon Relational Database Service', 'Relational Database Service'],
                'Lambda': ['Lambda', 'AWS Lambda'],
                'CloudWatch': ['CloudWatch', 'Amazon CloudWatch'],
                'ELB': ['ELB', 'Elastic Load Balancing', 'Load Balancer'],
                'VPC': ['VPC', 'Amazon Virtual Private Cloud', 'Virtual Private Cloud'],
                'IAM': ['IAM', 'AWS Identity and Access Management'],
                'CloudFormation': ['CloudFormation', 'AWS CloudFormation'],
                'TRUSTEDADVISOR': ['TRUSTEDADVISOR', 'Trusted Advisor', 'AWS Trusted Advisor']
              };
              
              // Try to extract information from cells first
              cells.forEach((cell, index) => {
                const text = cell.textContent.trim();
                
                // Enhanced service matching - check against all possible service names
                for (const [key, variations] of Object.entries(serviceMapping)) {
                  if (variations.some(variation => text.includes(variation))) {
                    service = key;
                    break;
                  }
                }
                
                // Common patterns for status - map to database values
                if (text.match(/^(Open|Active)/i)) {
                  status = 'open';
                } else if (text.match(/^(Upcoming|Scheduled)/i)) {
                  status = 'upcoming';
                } else if (text.match(/^(Closed|Completed|Resolved)/i)) {
                  status = 'closed';
                }
                
                // Common patterns for event categories
                if (text.match(/(Retirement|Reservation|Optimization|Migration|Notification)/i)) {
                  eventCategory = 'accountNotification';
                }
              });
              
              // If no cells found or no service extracted, try parsing the full row text
              if (!service && rowText) {
                // Enhanced service matching for full row text
                for (const [key, variations] of Object.entries(serviceMapping)) {
                  if (variations.some(variation => rowText.includes(variation))) {
                    service = key;
                    break;
                  }
                }
                
                const statusMatch = rowText.match(/(Open|Active|Upcoming|Scheduled|Closed|Completed|Resolved)/i);
                if (statusMatch) {
                  const matchedStatus = statusMatch[1].toLowerCase();
                  if (matchedStatus.match(/^(open|active)/i)) {
                    status = 'open';
                  } else if (matchedStatus.match(/^(upcoming|scheduled)/i)) {
                    status = 'upcoming';
                  } else if (matchedStatus.match(/^(closed|completed|resolved)/i)) {
                    status = 'closed';
                  }
                }
              }
              
              // Always create filters - if no specific service found, use a broad query
              let filters = {};
              
              if (service) {
                filters.service = service;
              }
              
              if (status) {
                filters.status_code = status;
              } else {
                // Default to open/upcoming events if no status extracted
                filters.status_code = 'open';
              }
              
              // Only add eventCategory if we have a specific match
              if (eventCategory && eventCategory !== 'accountNotification') {
                filters.eventCategory = eventCategory;
              }
              
              const filtersString = JSON.stringify(filters);
              handleDrillDown(filtersString);
            } else {
              // Always query with minimal filter - no static content
              const minimalFilters = JSON.stringify({
                status_code: 'open'
              });
              handleDrillDown(minimalFilters);
            }
          }
        }
      }
    };
    
    document.addEventListener('click', handleDrillDownClick, true); // Use capture phase
    
    // Also add a mutation observer to handle dynamically added content
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node contains drill-down links
              const drillDownLinks = node.querySelectorAll ? node.querySelectorAll('a[href*="drill-down"]') : [];
              // Also check for links with "View Details" text
              const viewDetailsLinks = node.querySelectorAll ? Array.from(node.querySelectorAll('a')).filter(link => link.textContent.includes('View Details')) : [];
              const totalLinks = drillDownLinks.length + viewDetailsLinks.length;
              if (totalLinks > 0) {
                console.log('🔗 Found drill-down links in dynamically added content:', totalLinks);
              }
            }
          });
        }
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    return () => {
      document.removeEventListener('click', handleDrillDownClick, true);
      observer.disconnect();
    };
  }, []);

  // Debug function to inspect View Details links (can be called from browser console)
  window.debugViewDetailsLinks = () => {
    const viewDetailsLinks = document.querySelectorAll('a, button, span, div');
    const matchingLinks = Array.from(viewDetailsLinks).filter(el => 
      el.textContent && el.textContent.includes('View Details')
    );
    
    console.log('🔍 Found View Details elements:', matchingLinks.length);
    matchingLinks.forEach((link, index) => {
      console.log(`🔍 Link ${index}:`, {
        element: link,
        tagName: link.tagName,
        textContent: link.textContent,
        href: link.href,
        onclick: link.getAttribute('onclick'),
        dataFilters: link.getAttribute('data-filters'),
        parentElement: link.parentElement,
        outerHTML: link.outerHTML.substring(0, 200)
      });
      
      // Also check if clicking this element would trigger our handler
      const testEvent = { target: link, preventDefault: () => {} };
      const isDrillDownLink = link.matches('a[href*="/drill-down"]') || 
                             link.matches('a[href*="drill-down"]') ||
                             (link.textContent && link.textContent.includes('View Details')) ||
                             (link.textContent && link.textContent.includes('drill-down')) ||
                             (link.parentElement && link.parentElement.textContent && link.parentElement.textContent.includes('View Details'));
      
      console.log(`🔍 Link ${index} would trigger handler:`, isDrillDownLink);
    });
    
    return matchingLinks;
  };
  


  const fetchCategories = async () => {
    try {
      setCategoriesLoading(true);
      const response = await fetch('/api/categories');
      const data = await response.json();
      setCategories(data);
      setInitialLoading(false);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setInitialLoading(false);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const fetchEventCategories = async () => {
    try {
      const response = await fetch('/api/event-categories');
      const result = await response.json();
      setEventCategories(result.data || result);
      setEventCategoriesLastRefreshed(result.lastRefreshed);
    } catch (error) {
      console.error('Error fetching event categories:', error);
    }
  };

  const fetchEventTypeStats = async () => {
    try {
      setEventTypeLoading(true);
      const response = await fetch(`/api/event-type-stats?t=${Date.now()}`);
      const result = await response.json();
      console.log('Event type stats received:', result);
      setEventTypeStats(result.data || result);
      setEventTypeStatsLastRefreshed(result.lastRefreshed);
    } catch (error) {
      console.error('Error fetching event type stats:', error);
    } finally {
      setEventTypeLoading(false);
    }
  };

  const fetchCategoryDetails = async (categoryId) => {
    try {
      const response = await fetch(`/api/category/${categoryId}`);
      const data = await response.json();
      setCategoryDetails(data);
      setSelectedCategory(categoryId);
    } catch (error) {
      console.error('Error fetching category details:', error);
    }
  };

  const fetchCriticalEvents = async () => {
    try {
      setCriticalEvents(prev => ({ ...prev, loading: true }));
      const response = await fetch('/api/critical-events-count');
      const data = await response.json();
      setCriticalEvents({ count: data.count || 0, loading: false });
    } catch (error) {
      console.error('Error fetching critical events:', error);
      setCriticalEvents({ count: 0, loading: false });
    }
  };

  const goBack = () => {
    setSelectedCategory(null);
    setSelectedEventCategory(null);
    setSelectedEventType(null);
    setCategoryDetails(null);
    setActiveTab('services');
    setShowAgenticDiagnostics(false);
    setShowCriticalEventsDetail(false);
    setShowCriticalEvents30to60Detail(false);
    setShowCriticalEventsPastDueDetail(false);
    setShowDrillDownDetail(false);
    setDrillDownData(null);
  };

  const handleCriticalEventsClick = async () => {
    try {
      setShowCriticalEventsDetail(true);
      setCriticalEventsAnalysis({ loading: true });
      
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const thirtyDaysFromNow = new Date(today);
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      
      const startDate = tomorrow.toISOString().split('T')[0];
      const endDate = thirtyDaysFromNow.toISOString().split('T')[0];
      
      // First check cache
      const cacheResponse = await fetch('/api/critical-events-analysis-cached');
      const cacheData = await cacheResponse.json();
      
      if (cacheData.success) {
        // Use cached HTML directly
        setCriticalEventsAnalysis({ 
          output: cacheData.output,
          cached: true,
          lastRefreshed: cacheData.lastRefreshed,
          ttlHours: cacheData.ttlHours
        });
        return;
      }
      
      // Cache expired or doesn't exist, fetch fresh data
      const response = await fetch('/api/critical-events-analysis-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: `Show me all critical events that have start_time between ${startDate} and ${endDate}. Query all existing events in the database and filter for those with start_time in this future date range. Include all events with status 'upcoming' or 'open' and focus on events that require immediate attention. 

Return your response as a complete HTML table wrapped in \`\`\`html\`\`\` code blocks. Please format the response as an HTML table with the following columns:
Time
AWS Service
Title
Event
Business Impact
Status

Include all critical events for this time period with complete details for each column. Make sure to wrap your HTML response in \`\`\`html\`\`\` and \`\`\` tags.`
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Use the HTML content directly (already extracted by server)
        setCriticalEventsAnalysis({ 
          output: data.output,
          cached: false,
          lastRefreshed: data.lastRefreshed,
          ttlHours: data.ttlHours
        });
      } else {
        setCriticalEventsAnalysis({ error: data.error || 'Analysis failed' });
      }
    } catch (error) {
      console.error('Error fetching critical events analysis:', error);
      setCriticalEventsAnalysis({ error: 'Failed to load analysis' });
    }
  };

  const handleCriticalEvents30to60Click = async () => {
    try {
      setShowCriticalEvents30to60Detail(true);
      setCriticalEvents30to60Analysis({ loading: true });
      
      const today = new Date();
      const thirtyDaysFromNow = new Date(today);
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      const sixtyDaysFromNow = new Date(today);
      sixtyDaysFromNow.setDate(today.getDate() + 60);
      
      const startDate = thirtyDaysFromNow.toISOString().split('T')[0];
      const endDate = sixtyDaysFromNow.toISOString().split('T')[0];
      
      // First check cache for 30-60 days
      const cacheResponse = await fetch('/api/critical-events-analysis-cached-60');
      const cacheData = await cacheResponse.json();
      
      if (cacheData.success) {
        // Use cached HTML directly
        setCriticalEvents30to60Analysis({ 
          output: cacheData.output,
          cached: true,
          lastRefreshed: cacheData.lastRefreshed,
          ttlHours: cacheData.ttlHours
        });
        return;
      }
      
      // Cache expired or doesn't exist, fetch fresh data
      const response = await fetch('/api/critical-events-analysis-refresh-60', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: `Show me all critical events that have start_time between ${startDate} and ${endDate}. Query all existing events in the database and filter for those with start_time in this future date range. Include events with status 'upcoming' or 'open' and focus on events that require immediate attention. Please format the response as an HTML table with the following columns:
Time 
AWS Service  
Title 
Event 
Business Impact 
Status
Include all critical events for this time period with complete details for each column.`
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCriticalEvents30to60Analysis({ 
          output: data.output,
          cached: false,
          lastRefreshed: data.lastRefreshed,
          ttlHours: data.ttlHours
        });
      } else {
        setCriticalEvents30to60Analysis({ error: data.error || 'Analysis failed' });
      }
    } catch (error) {
      console.error('Error fetching critical events 30-60 analysis:', error);
      setCriticalEvents30to60Analysis({ error: 'Failed to load analysis' });
    }
  };

  const handleCriticalEventsPastDueClick = async () => {
    try {
      setShowCriticalEventsPastDueDetail(true);
      setCriticalEventsPastDueAnalysis({ loading: true });
      
      const today = new Date();
      const currentDate = today.toISOString().split('T')[0];
      const oneHundredTwentyDaysAgo = new Date(today);
      oneHundredTwentyDaysAgo.setDate(today.getDate() - 120);
      const startDate = oneHundredTwentyDaysAgo.toISOString().split('T')[0];
      
      // First check cache for Past Due events
      const cacheResponse = await fetch('/api/critical-events-analysis-cached-pastdue');
      const cacheData = await cacheResponse.json();
      
      if (cacheData.success) {
        // Use cached HTML directly
        setCriticalEventsPastDueAnalysis({ 
          output: cacheData.output,
          cached: true,
          lastRefreshed: cacheData.lastRefreshed,
          ttlHours: cacheData.ttlHours
        });
        return;
      }
      
      // Cache expired or doesn't exist, fetch fresh data
      const response = await fetch('/api/critical-events-analysis-refresh-pastdue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: `Show me ALL events where start_time is between ${startDate} and ${currentDate} (past 120 days) AND status is 'upcoming' or 'open'. These are past due events. Filter by start_time >= '${startDate}' AND start_time < '${currentDate}' AND status in ('upcoming', 'open').

Return a complete HTML table with ALL matching events. Format as HTML table with these columns:
Time
AWS Service
Title
Event
Business Impact
Status

Show every single past due event found. Do not limit or summarize results.`
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCriticalEventsPastDueAnalysis({ 
          output: data.output,
          cached: false,
          lastRefreshed: data.lastRefreshed,
          ttlHours: data.ttlHours
        });
      } else {
        setCriticalEventsPastDueAnalysis({ error: data.error || 'Analysis failed' });
      }
    } catch (error) {
      console.error('Error fetching past due events analysis:', error);
      setCriticalEventsPastDueAnalysis({ error: 'Failed to load analysis' });
    }
  };

  const handleEventCategoryClick = (categoryId) => {
    setSelectedEventCategory(categoryId);
  };

  const handleEventTypeClick = (eventTypeId) => {
    setSelectedEventType(eventTypeId);
  };

  const handleRefreshData = async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/refresh-cache', { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        // Refetch all data
        await Promise.all([
          fetchEventCategories(),
          fetchEventTypeStats()
        ]);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const getUrgencyLevel = (upcomingEvents, totalEvents) => {
    const ratio = upcomingEvents / totalEvents;
    if (upcomingEvents > 1000 || ratio > 0.5) return 'high';
    if (upcomingEvents > 10 || ratio > 0.1) return 'medium';
    return 'low';
  };

  if (initialLoading) {
    return (
      <div className="app">
        <Header />
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading AWS Health Events...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header />
      
      <main className="main-content">
        {showAgenticDiagnostics ? (
          <AgenticDiagnosticsView 
            onBack={goBack}
            analysisResults={analysisResults}
            setAnalysisResults={setAnalysisResults}
          />
        ) : showCriticalEventsDetail ? (
          <CriticalEventsDetail 
            analysis={criticalEventsAnalysis}
            onBack={goBack}
            startDate={(() => {
              const today = new Date();
              const tomorrow = new Date(today);
              tomorrow.setDate(today.getDate() + 1);
              return tomorrow.toISOString().split('T')[0];
            })()}
            endDate={(() => {
              const today = new Date();
              const thirtyDaysFromNow = new Date(today);
              thirtyDaysFromNow.setDate(today.getDate() + 30);
              return thirtyDaysFromNow.toISOString().split('T')[0];
            })()}
          />
        ) : showCriticalEvents30to60Detail ? (
          <CriticalEventsDetail 
            analysis={criticalEvents30to60Analysis}
            onBack={() => setShowCriticalEvents30to60Detail(false)}
            startDate={(() => {
              const today = new Date();
              const thirtyDaysFromNow = new Date(today);
              thirtyDaysFromNow.setDate(today.getDate() + 30);
              return thirtyDaysFromNow.toISOString().split('T')[0];
            })()}
            endDate={(() => {
              const today = new Date();
              const sixtyDaysFromNow = new Date(today);
              sixtyDaysFromNow.setDate(today.getDate() + 60);
              return sixtyDaysFromNow.toISOString().split('T')[0];
            })()}
          />
        ) : showCriticalEventsPastDueDetail ? (
          <PastDueEventsDetail 
            analysis={criticalEventsPastDueAnalysis}
            onBack={() => setShowCriticalEventsPastDueDetail(false)}
            startDate={(() => {
              const today = new Date();
              const oneHundredTwentyDaysAgo = new Date(today);
              oneHundredTwentyDaysAgo.setDate(today.getDate() - 120);
              return oneHundredTwentyDaysAgo.toISOString().split('T')[0];
            })()}
            endDate={(() => {
              const today = new Date();
              return today.toISOString().split('T')[0];
            })()}
          />
        ) : showDrillDownDetail ? (
          <DrillDownDetail 
            data={drillDownData}
            onBack={() => {
              setShowDrillDownDetail(false);
              setDrillDownData(null);
              
              // Return to the previous view
              if (previousView === 'agentic') {
                setShowAgenticDiagnostics(true);
              }
              // If previousView is 'dashboard' or null, stay on main dashboard (default behavior)
              
              setPreviousView(null); // Reset previous view
            }}
          />
        ) : selectedEventCategory ? (
          <EventCategoryDetail 
            categoryId={selectedEventCategory}
            onBack={goBack}
          />
        ) : selectedEventType ? (
          <EventTypeDetail 
            eventTypeId={selectedEventType}
            onBack={goBack}
          />
        ) : !selectedCategory ? (
          <CategoryOverview 
            categories={categories}
            eventCategories={eventCategories}
            eventTypeStats={eventTypeStats}
            onCategoryClick={fetchCategoryDetails}
            onEventCategoryClick={handleEventCategoryClick}
            onEventTypeClick={handleEventTypeClick}
            onAgenticDiagnosticsClick={() => setShowAgenticDiagnostics(true)}
            onCriticalEventsClick={handleCriticalEventsClick}
            onCriticalEvents30to60Click={handleCriticalEvents30to60Click}
            onCriticalEventsPastDueClick={handleCriticalEventsPastDueClick}
            onRefreshData={handleRefreshData}
            getUrgencyLevel={getUrgencyLevel}
            eventTypeLoading={eventTypeLoading}
            categoriesLoading={categoriesLoading}
            eventCategoriesLastRefreshed={eventCategoriesLastRefreshed}
            eventTypeStatsLastRefreshed={eventTypeStatsLastRefreshed}
            criticalEvents={criticalEvents}
            refreshing={refreshing}
          />
        ) : (
          <CategoryDetail 
            category={categoryDetails}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onBack={goBack}
          />
        )}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <h1>Health Event Intelligence</h1>
        <span className="header-subtitle">Proactive AWS Health Management</span>
      </div>
    </header>
  );
}

function CategoryOverview({ categories, eventCategories, eventTypeStats, eventTypeLoading, categoriesLoading, onCategoryClick, onEventCategoryClick, onEventTypeClick, onAgenticDiagnosticsClick, onCriticalEventsClick, onCriticalEvents30to60Click, onCriticalEventsPastDueClick, onRefreshData, getUrgencyLevel, eventCategoriesLastRefreshed, eventTypeStatsLastRefreshed, refreshing, criticalEvents }) {

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">AWS Health Event Dashboard</h1>
        </div>
        <div className="header-buttons">
          <button className="refresh-button" onClick={onAgenticDiagnosticsClick}>
            🔬 Agentic Diagnostics
          </button>

          <button 
            className="refresh-button" 
            onClick={onRefreshData}
            disabled={refreshing}
          >
            {refreshing ? '🔄 Refreshing...' : '🔄 Refresh Data'}
          </button>
        </div>
      </div>
      
      <div className="critical-events-section">
        <div className="section-header">
          <h2 className="section-title">Critical Events</h2>
          <p className="last-refreshed">
            Data as of {new Date().toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>
        <div className="critical-events-grid">
          <div 
            className="critical-events-tile"
            onClick={onCriticalEventsClick}
          >
            <h3 className="tile-title">Upcoming Critical Events in next 30 days</h3>
          </div>
          <div 
            className="critical-events-tile"
            onClick={onCriticalEvents30to60Click}
          >
            <h3 className="tile-title">Upcoming Critical Events in the next 30 to 60 days</h3>
          </div>
          <div 
            className="critical-events-tile"
            onClick={onCriticalEventsPastDueClick}
          >
            <h3 className="tile-title">Past Due Events - 120 Days</h3>
          </div>
        </div>
      </div>
      
      <div className="event-categories-section">
        <div className="section-header">
          <h2 className="section-title">Event Categories</h2>
          {eventCategoriesLastRefreshed && (
            <p className="last-refreshed">
              Data last refreshed as of {new Date(eventCategoriesLastRefreshed).toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          )}
        </div>
        <div className="event-categories-grid">
          {eventCategories.length === 0 ? (
            <div style={{gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#5a6c7d'}}>
              Loading event categories...
            </div>
          ) : (
            eventCategories.map((category) => (
              <div 
                key={category.id} 
                className="event-category-tile"
                onClick={() => onEventCategoryClick(category.id)}
              >
                <h3 className="event-category-name">{category.name}</h3>
                <p className="event-category-description">{category.description}</p>
                <div className="event-category-stats">
                  <div className="stat-item">
                    <span className="stat-number">{category.eventCount.toLocaleString()}</span>
                    <span className="stat-label">Events</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-number">{category.serviceCount}</span>
                    <span className="stat-label">Services</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      <hr className="section-divider" />
      
      <div className="event-types-section">
        <div className="section-header">
          <h2 className="section-title">Event Type</h2>
          {eventTypeStatsLastRefreshed && (
            <p className="last-refreshed">
              Data last refreshed as of {new Date(eventTypeStatsLastRefreshed).toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          )}
        </div>
        <div className="event-types-grid">
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('configuration-alerts')}
          >
            <h3 className="event-type-name">Configuration Alerts</h3>
            <p className="event-type-description">Configuration issues, expiring resources</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.configurationAlerts && eventTypeStats.configurationAlerts.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.configurationAlerts && eventTypeStats.configurationAlerts.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('cost-impact-events')}
          >
            <h3 className="event-type-name">Cost Impact Events</h3>
            <p className="event-type-description">Billing changes, capacity reservations, cost impacts</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.costImpactEvents && eventTypeStats.costImpactEvents.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.costImpactEvents && eventTypeStats.costImpactEvents.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('maintenance-updates')}
          >
            <h3 className="event-type-name">Maintenance Updates</h3>
            <p className="event-type-description">Scheduled maintenance, automatic updates</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.maintenanceUpdates && eventTypeStats.maintenanceUpdates.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.maintenanceUpdates && eventTypeStats.maintenanceUpdates.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('migration-requirements')}
          >
            <h3 className="event-type-name">Migration Requirements</h3>
            <p className="event-type-description">Platform migrations, version upgrades, instance retirements</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.migrationRequirements && eventTypeStats.migrationRequirements.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.migrationRequirements && eventTypeStats.migrationRequirements.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('operational-notifications')}
          >
            <h3 className="event-type-name">Operational Notifications</h3>
            <p className="event-type-description">Service issues, operational alerts</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.operationalNotifications && eventTypeStats.operationalNotifications.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.operationalNotifications && eventTypeStats.operationalNotifications.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
          <div 
            className="event-type-tile"
            onClick={() => !eventTypeLoading && onEventTypeClick('security-compliance')}
          >
            <h3 className="event-type-name">Security Compliance</h3>
            <p className="event-type-description">Security patches, vulnerability notifications</p>
            {eventTypeLoading ? (
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Fetching data...</span>
              </div>
            ) : (
              <div className="event-type-stats">
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.securityCompliance && eventTypeStats.securityCompliance.eventCount) || 0}</span>
                  <span className="stat-label">Events</span>
                </div>
                <div className="stat-item">
                  <span className="stat-number">{(eventTypeStats.securityCompliance && eventTypeStats.securityCompliance.serviceCount) || 0}</span>
                  <span className="stat-label">Services</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="categories-grid">
        {categoriesLoading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="category-card loading">
              <div className="category-header">
                <div>
                  <h3 className="category-title">Loading...</h3>
                  <p className="category-description">Fetching data from database...</p>
                </div>
              </div>
              <div className="loading-state">
                <div className="loading-spinner-small"></div>
                <span className="loading-text">Please wait</span>
              </div>
            </div>
          ))
        ) : (
          categories.map((category) => (
          <div 
            key={category.id} 
            className="category-card"
            onClick={() => onCategoryClick(category.id)}
          >
            {category.upcomingEvents > 0 && (
              <div className={`upcoming-badge ${getUrgencyLevel(category.upcomingEvents, category.totalEvents)}`}>
                {category.upcomingEvents} upcoming
              </div>
            )}
            
            <div className="category-header">
              <div>
                <h3 className="category-title">{category.name}</h3>
                <p className="category-description">{category.description}</p>
              </div>
            </div>
            
            <div className="category-stats">
              <div className="stat-item">
                <span className="stat-number">{category.totalEvents.toLocaleString()}</span>
                <span className="stat-label">Total Events</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">{category.servicesAffected}</span>
                <span className="stat-label">Services</span>
              </div>
            </div>
          </div>
          ))
        )}
      </div>
    </>
  );
}

function PastDueEventsDetail({ analysis, onBack, startDate, endDate }) {
  return (
    <div className="detail-view">
      <div className="detail-header">
        <h2 className="detail-title" style={{ color: 'red' }}>
          AWS Health Events - Past Due Events
          {startDate && endDate && ` - (${startDate} - ${endDate})`}
        </h2>
        {analysis?.lastRefreshed && (
          <p className="last-refreshed">
            Last refreshed: {new Date(analysis.lastRefreshed).toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            {analysis.cached && ` (cached, TTL: ${analysis.ttlHours}h)`}
          </p>
        )}
        <button className="back-button" onClick={onBack}>
          ← Back to Overview
        </button>
      </div>

      <div className="analysis-content">
        {analysis?.loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Analyzing past due events...</p>
          </div>
        ) : analysis?.error ? (
          <div className="error-container">
            <p className="error-message">Error: {analysis.error}</p>
          </div>
        ) : analysis?.output ? (
          <div 
            className="analysis-output"
            dangerouslySetInnerHTML={{ __html: analysis.output }}
          />
        ) : (
          <div className="no-data">
            <p>No analysis data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CriticalEventsDetail({ analysis, onBack, startDate, endDate }) {
  return (
    <div className="detail-view">
      <div className="detail-header">
        <h2 className="detail-title">
          Critical AWS Health Events
          {startDate && endDate && ` - (${startDate} - ${endDate})`}
        </h2>
        {analysis?.lastRefreshed && (
          <p className="last-refreshed">
            Last refreshed: {new Date(analysis.lastRefreshed).toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            {analysis.cached && ` (cached, TTL: ${analysis.ttlHours}h)`}
          </p>
        )}
        <button className="back-button" onClick={onBack}>
          ← Back to Overview
        </button>
      </div>

      <div className="analysis-content">
        {analysis?.loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Analyzing critical events...</p>
          </div>
        ) : analysis?.error ? (
          <div className="error-message">
            <p>Error: {analysis.error}</p>
          </div>
        ) : analysis?.output ? (
          <div 
            className="analysis-html-content"
            dangerouslySetInnerHTML={{ __html: analysis.output }}
          />
        ) : (
          <div className="no-data">
            <p>No analysis data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryDetail({ category, activeTab, setActiveTab, onBack }) {
  if (!category) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'services':
        return <ServiceBreakdown services={category.events_by_service} />;
      case 'status':
        return <StatusBreakdown statuses={category.events_by_status} />;
      case 'events':
        return <EventsList events={category.all_events} />;
      default:
        return null;
    }
  };

  return (
    <div className="detail-view">
      <div className="detail-header">
        <h2 className="detail-title">
          {category.category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </h2>
        <button className="back-button" onClick={onBack}>
          ← Back to Overview
        </button>
      </div>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveTab('services')}
        >
          By Service ({Object.keys(category.events_by_service).length})
        </button>
        <button 
          className={`tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          By Status
        </button>
        <button 
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          All Events ({category.all_events.length})
        </button>
      </div>

      {renderTabContent()}
    </div>
  );
}

function ServiceBreakdown({ services }) {
  return (
    <div className="events-list">
      {Object.entries(services).map(([service, events]) => (
        <div key={service} className="event-item">
          <div className="event-header">
            <span className="event-service">{service}</span>
            <span className="event-status upcoming">{events.length} events</span>
          </div>
          <div className="event-details">
            Upcoming: {events.filter(e => e.status === 'upcoming').length} • 
            Regions: {[...new Set(events.map(e => e.region))].length}
          </div>
          {events.slice(0, 3).map((event, idx) => (
            <div key={idx} className="event-arn">{event.arn}</div>
          ))}
          {events.length > 3 && (
            <div style={{color: '#5a6c7d', fontSize: '0.8rem', marginTop: '0.5rem'}}>
              ... and {events.length - 3} more events
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBreakdown({ statuses }) {
  return (
    <div className="events-list">
      {Object.entries(statuses).map(([status, events]) => (
        <div key={status} className="event-item">
          <div className="event-header">
            <span className="event-service">Status: {status.toUpperCase()}</span>
            <span className={`event-status ${status}`}>{events.length} events</span>
          </div>
          <div className="event-details">
            Services: {[...new Set(events.map(e => e.service))].join(', ')}
          </div>
          {events.slice(0, 2).map((event, idx) => (
            <div key={idx} className="event-arn">{event.arn}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function EventsList({ events }) {
  return (
    <div className="events-list">
      {events.slice(0, 50).map((event, idx) => (
        <div key={idx} className="event-item">
          <div className="event-header">
            <span className="event-service">{event.service} - {event.region}</span>
            <span className={`event-status ${event.status}`}>{event.status}</span>
          </div>
          <div className="event-details">
            {event.event_type} • {event.start_time}
          </div>
          <div className="event-arn">{event.arn}</div>
          {event.description_preview && (
            <div style={{fontSize: '0.8rem', color: '#5a6c7d', marginTop: '0.5rem'}}>
              {event.description_preview}
            </div>
          )}
        </div>
      ))}
      {events.length > 50 && (
        <div style={{textAlign: 'center', padding: '1rem', color: '#5a6c7d'}}>
          Showing first 50 of {events.length} events
        </div>
      )}
    </div>
  );
}

function EventCategoryDetail({ categoryId, onBack }) {
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filters, setFilters] = useState({
    services: [],
    statuses: [],
    startDate: '',
    endDate: ''
  });

  const fetchCategoryEvents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event-category-details/${categoryId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const events = data.events || [];
      setEvents(events);
      setLastUpdated(data.lastUpdated);
      
      // Extract unique values for filters
      const uniqueServices = [...new Set(events.map(e => e.service).filter(Boolean))];
      const uniqueStatuses = [...new Set(events.map(e => e.status_code).filter(Boolean))];
      setServices(uniqueServices.sort());
      setStatuses(uniqueStatuses.sort());
    } catch (error) {
      console.error('Error fetching category events:', error);
      setEvents([]);
      setServices([]);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  const applyFilters = useCallback(() => {
    let filtered = [...events];

    if (filters.services.length > 0 && !filters.services.includes('')) {
      filtered = filtered.filter(event => filters.services.includes(event.service));
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes('')) {
      filtered = filtered.filter(event => filters.statuses.includes(event.status_code));
    }

    if (filters.startDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.last_update);
        return eventDate >= new Date(filters.startDate);
      });
    }

    if (filters.endDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.last_update);
        return eventDate <= new Date(filters.endDate + 'T23:59:59');
      });
    }

    // Group by date and sort
    filtered.sort((a, b) => {
      const dateA = new Date(a.last_update);
      const dateB = new Date(b.last_update);
      if (dateB - dateA !== 0) return dateB - dateA;
      if (a.service !== b.service) return (a.service || '').localeCompare(b.service || '');
      if (a.title !== b.title) return (a.title || '').localeCompare(b.title || '');
      if (a.event !== b.event) return (a.event || '').localeCompare(b.event || '');
      return (a.status_code || '').localeCompare(b.status_code || '');
    });

    // Deduplicate rows and combine ARNs
    const eventMap = new Map();

    filtered.forEach(event => {
      const scheduleDateTime = event.__summary?.schedule?.[0]?.datetime || event.last_update;
      const scheduleEvent = event.__summary?.schedule?.[0]?.event || 'N/A';
      const key = `${scheduleDateTime}|${event.service}|${event.title}|${scheduleEvent}|${event.status_code}`;
      
      if (eventMap.has(key)) {
        // Combine ARNs
        const existingEvent = eventMap.get(key);
        if (event.arn && existingEvent.arn) {
          existingEvent.arn = `${existingEvent.arn},${event.arn}`;
        } else if (event.arn) {
          existingEvent.arn = event.arn;
        }
      } else {
        eventMap.set(key, { ...event });
      }
    });

    const uniqueEvents = Array.from(eventMap.values());
    setFilteredEvents(uniqueEvents);
  }, [events, filters]);

  useEffect(() => {
    fetchCategoryEvents();
  }, [fetchCategoryEvents]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const handleFilterChange = (filterType, value) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));
  };

  const exportToExcel = () => {
    const csvData = [];
    
    // Add header row
    csvData.push(['DateTime', 'AWS Service', 'Title', 'Event', 'Business Impact', 'Status', 'ARNs']);
    
    // Add data rows
    filteredEvents.forEach(event => {
      const scheduleDateTime = event.__summary?.schedule?.[0]?.datetime || event.last_update;
      const scheduleEvent = event.__summary?.schedule?.[0]?.event || 'N/A';
      
      csvData.push([
        scheduleDateTime,
        event.service || 'N/A',
        event.title || 'N/A',
        scheduleEvent,
        event.risk || 'N/A',
        event.status_code || 'N/A',
        event.arn || 'N/A'
      ]);
    });
    
    // Convert to CSV string
    const csvContent = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${categoryId}_events_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = async (arn) => {
    try {
      await navigator.clipboard.writeText(arn);
      // Could add a toast notification here if desired
    } catch (err) {
      console.error('Failed to copy ARN to clipboard:', err);
    }
  };

  const getArnCount = (arn) => {
    if (!arn) return 0;
    // Count ARNs by splitting on common delimiters and filtering non-empty strings
    const arns = arn.split(/[,;\n]/).filter(a => a.trim().length > 0);
    return arns.length;
  };

  const getArnButtonText = (arn) => {
    const count = getArnCount(arn);
    return count === 1 ? 'Copy 1 ARN' : `Copy ${count} ARNs`;
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeZoneName: 'short'
    });
  };

  const formatDateOnly = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const groupEventsByDate = (events) => {
    const grouped = {};
    events.forEach(event => {
      const dateKey = new Date(event.last_update).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  };

  const groupedEvents = groupEventsByDate(filteredEvents);

  return (
    <div className="detail-view">
      <div className="detail-header">
        <div>
          <h1 className="detail-main-title">AWS Customer Health and Planned Lifecycle Intelligence</h1>
          <h2 className="detail-category-title">Category: {categoryId.charAt(0).toUpperCase() + categoryId.slice(1)}</h2>
          {lastUpdated && (
            <div className="last-updated">
              Data last refreshed as of {new Date(lastUpdated).toLocaleDateString()}, {new Date(lastUpdated).toLocaleTimeString()}, {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </div>
          )}
        </div>
        <div className="header-buttons">
          <button className="export-button" onClick={exportToExcel}>
            📊 Export to Excel
          </button>
          <button className="back-button" onClick={onBack}>
            ← Back to Overview
          </button>
        </div>
      </div>

      <div className="filters-section">
        <div className="filter-row">
          <div className="filter-group">
            <label>Service:</label>
            <select 
              multiple 
              value={filters.services}
              onChange={(e) => handleFilterChange('services', Array.from(e.target.selectedOptions, option => option.value))}
              className="multi-select"
            >
              <option value="">ALL</option>
              {services.map(service => (
                <option key={service} value={service}>{service}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Status:</label>
            <select 
              multiple 
              value={filters.statuses}
              onChange={(e) => handleFilterChange('statuses', Array.from(e.target.selectedOptions, option => option.value))}
              className="multi-select"
            >
              <option value="">ALL</option>
              {statuses.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Start Date:</label>
            <input 
              type="date" 
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
          </div>
          
          <div className="filter-group">
            <label>End Date:</label>
            <input 
              type="date" 
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading events...</p>
        </div>
      ) : (
        <div className="events-table-container">
          {Object.keys(groupedEvents).length === 0 ? (
            <div className="empty-state">
              <p>No events found matching the selected filters.</p>
            </div>
          ) : (
            Object.keys(groupedEvents).map(dateKey => (
              <div key={dateKey} className="date-group">
                <div className="date-band">
                  {formatDateOnly(dateKey)}
                </div>
                <div className="events-table">
                  <div className="table-header">
                    <div className="col-time">Time</div>
                    <div className="col-service">AWS Service</div>
                    <div className="col-title">Title</div>
                    <div className="col-event">Event</div>
                    <div className="col-impact">Business Impact</div>
                    <div className="col-status">Status</div>
                    <div className="col-arn">ARN</div>
                  </div>
                  {groupedEvents[dateKey].map((event, index) => (
                    <div key={index} className="table-row">
                      <div className="col-time">{event.__summary?.schedule?.[0]?.datetime ? formatDateTime(event.__summary.schedule[0].datetime) : formatDateTime(event.last_update)}</div>
                      <div className="col-service">{event.service || 'N/A'}</div>
                      <div className="col-title">{event.title || 'N/A'}</div>
                      <div className="col-event">{event.__summary?.schedule?.[0]?.event || 'N/A'}</div>
                      <div className="col-impact">{event.risk || 'N/A'}</div>
                      <div className="col-status">{event.status_code || 'N/A'}</div>
                      <div className="col-arn">
                        {event.arn ? (
                          <button 
                            className="arn-link" 
                            onClick={() => copyToClipboard(event.arn)}
                            title="Click to copy ARN to clipboard"
                          >
                            {getArnButtonText(event.arn)}
                          </button>
                        ) : 'N/A'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EventTypeDetail({ eventTypeId, onBack }) {
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filters, setFilters] = useState({
    services: [],
    statuses: [],
    startDate: '',
    endDate: ''
  });

  const fetchEventTypeEvents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event-type-details/${eventTypeId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const events = data.events || [];
      setEvents(events);
      setLastUpdated(data.lastUpdated);
      
      // Extract unique values for filters
      const uniqueServices = [...new Set(events.map(e => e.service).filter(Boolean))];
      const uniqueStatuses = [...new Set(events.map(e => e.status_code).filter(Boolean))];
      setServices(uniqueServices.sort());
      setStatuses(uniqueStatuses.sort());
    } catch (error) {
      console.error('Error fetching event type events:', error);
      setEvents([]);
      setServices([]);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, [eventTypeId]);

  const applyFilters = useCallback(() => {
    let filtered = [...events];

    if (filters.services.length > 0 && !filters.services.includes('')) {
      filtered = filtered.filter(event => filters.services.includes(event.service));
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes('')) {
      filtered = filtered.filter(event => filters.statuses.includes(event.status_code));
    }

    if (filters.startDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.last_update);
        return eventDate >= new Date(filters.startDate);
      });
    }

    if (filters.endDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.last_update);
        return eventDate <= new Date(filters.endDate + 'T23:59:59');
      });
    }

    // Group by date and sort
    filtered.sort((a, b) => {
      const dateA = new Date(a.last_update);
      const dateB = new Date(b.last_update);
      if (dateB - dateA !== 0) return dateB - dateA;
      if (a.service !== b.service) return (a.service || '').localeCompare(b.service || '');
      if (a.title !== b.title) return (a.title || '').localeCompare(b.title || '');
      if (a.event !== b.event) return (a.event || '').localeCompare(b.event || '');
      return (a.status_code || '').localeCompare(b.status_code || '');
    });

    // Deduplicate rows and combine ARNs
    const eventMap = new Map();

    filtered.forEach(event => {
      const scheduleDateTime = event.__summary?.schedule?.[0]?.datetime || event.last_update;
      const scheduleEvent = event.__summary?.schedule?.[0]?.event || 'N/A';
      const key = `${scheduleDateTime}|${event.service}|${event.title}|${scheduleEvent}|${event.status_code}`;
      
      if (eventMap.has(key)) {
        // Combine ARNs
        const existingEvent = eventMap.get(key);
        if (event.arn && existingEvent.arn) {
          existingEvent.arn = `${existingEvent.arn},${event.arn}`;
        } else if (event.arn) {
          existingEvent.arn = event.arn;
        }
      } else {
        eventMap.set(key, { ...event });
      }
    });

    const uniqueEvents = Array.from(eventMap.values());
    setFilteredEvents(uniqueEvents);
  }, [events, filters]);

  const handleFilterChange = (filterType, value) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));
  };

  useEffect(() => {
    fetchEventTypeEvents();
  }, [eventTypeId, fetchEventTypeEvents]);

  useEffect(() => {
    applyFilters();
  }, [events, filters, applyFilters]);

  const exportToExcel = () => {
    const csvData = [];
    
    // Add header row
    csvData.push(['DateTime', 'AWS Service', 'Title', 'Event', 'Business Impact', 'Status', 'ARNs']);
    
    // Add data rows
    filteredEvents.forEach(event => {
      const scheduleDateTime = event.__summary?.schedule?.[0]?.datetime || event.last_update;
      const scheduleEvent = event.__summary?.schedule?.[0]?.event || 'N/A';
      
      csvData.push([
        scheduleDateTime,
        event.service || 'N/A',
        event.title || 'N/A',
        scheduleEvent,
        event.risk || 'N/A',
        event.status_code || 'N/A',
        event.arn || 'N/A'
      ]);
    });
    
    // Convert to CSV string
    const csvContent = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${eventTypeId}_events_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = async (arn) => {
    try {
      await navigator.clipboard.writeText(arn);
    } catch (err) {
      console.error('Failed to copy ARN to clipboard:', err);
    }
  };

  const getArnCount = (arn) => {
    if (!arn) return 0;
    const arns = arn.split(/[,;\n]/).filter(a => a.trim().length > 0);
    return arns.length;
  };

  const getArnButtonText = (arn) => {
    const count = getArnCount(arn);
    return count === 1 ? 'Copy 1 ARN' : `Copy ${count} ARNs`;
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeZoneName: 'short'
    });
  };

  const formatDateOnly = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const groupEventsByDate = (events) => {
    const grouped = {};
    events.forEach(event => {
      const dateKey = new Date(event.last_update).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  };

  const getDisplayName = (id) => {
    return id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const groupedEvents = groupEventsByDate(filteredEvents);
  
  return (
    <div className="detail-view">
      <div className="detail-header">
        <div>
          <h1 className="detail-main-title">AWS Customer Health and Planned Lifecycle Intelligence</h1>
          <h2 className="detail-category-title">Event Type: {getDisplayName(eventTypeId)}</h2>
          {lastUpdated && (
            <div className="last-updated">
              Data last refreshed as of {new Date(lastUpdated).toLocaleDateString()}, {new Date(lastUpdated).toLocaleTimeString()}, {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </div>
          )}
        </div>
        <div className="header-buttons">
          <button className="export-button" onClick={exportToExcel}>
            📊 Export to Excel
          </button>
          <button className="back-button" onClick={onBack}>
            ← Back to Overview
          </button>
        </div>
      </div>

      <div className="filters-section">
        <div className="filter-row">
          <div className="filter-group">
            <label>Service:</label>
            <select 
              multiple 
              value={filters.services}
              onChange={(e) => handleFilterChange('services', Array.from(e.target.selectedOptions, option => option.value))}
              className="multi-select"
            >
              <option value="">ALL</option>
              {services.map(service => (
                <option key={service} value={service}>{service}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Status:</label>
            <select 
              multiple 
              value={filters.statuses}
              onChange={(e) => handleFilterChange('statuses', Array.from(e.target.selectedOptions, option => option.value))}
              className="multi-select"
            >
              <option value="">ALL</option>
              {statuses.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Start Date:</label>
            <input 
              type="date" 
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
          </div>
          
          <div className="filter-group">
            <label>End Date:</label>
            <input 
              type="date" 
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading events...</p>
        </div>
      ) : (
        <div className="events-table-container">
          {Object.keys(groupedEvents).length === 0 ? (
            <div className="empty-state">
              <p>No events found matching the selected filters.</p>
            </div>
          ) : (
            Object.keys(groupedEvents).map(dateKey => (
              <div key={dateKey} className="date-group">
                <div className="date-band">
                  {formatDateOnly(dateKey)}
                </div>
                <div className="events-table">
                  <div className="table-header">
                    <div className="col-time">Time</div>
                    <div className="col-service">AWS Service</div>
                    <div className="col-title">Title</div>
                    <div className="col-event">Event</div>
                    <div className="col-impact">Business Impact</div>
                    <div className="col-status">Status</div>
                    <div className="col-arn">ARN</div>
                  </div>
                  {groupedEvents[dateKey].map((event, index) => (
                    <div key={index} className="table-row">
                      <div className="col-time">{event.__summary?.schedule?.[0]?.datetime ? formatDateTime(event.__summary.schedule[0].datetime) : formatDateTime(event.last_update)}</div>
                      <div className="col-service">{event.service || 'N/A'}</div>
                      <div className="col-title">{event.title || 'N/A'}</div>
                      <div className="col-event">{event.__summary?.schedule?.[0]?.event || 'N/A'}</div>
                      <div className="col-impact">{event.risk || 'N/A'}</div>
                      <div className="col-status">{event.status_code || 'N/A'}</div>
                      <div className="col-arn">
                        {event.arn ? (
                          <button 
                            className="arn-link" 
                            onClick={() => copyToClipboard(event.arn)}
                            title="Click to copy ARN to clipboard"
                          >
                            {getArnButtonText(event.arn)}
                          </button>
                        ) : 'N/A'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DrillDownDetail({ data, onBack }) {
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [filters, setFilters] = useState({
    services: [],
    statuses: [],
    startDate: '',
    endDate: ''
  });
  const [services, setServices] = useState([]);
  const [statuses, setStatuses] = useState([]);

  useEffect(() => {
    console.log('🔍 DrillDownDetail data changed:', data);
    if (data?.events) {
      console.log('🔍 DrillDownDetail received events:', data.events.length);
      // Extract unique values for additional filters
      const uniqueServices = [...new Set(data.events.map(e => e.service).filter(Boolean))];
      const uniqueStatuses = [...new Set(data.events.map(e => e.status_code).filter(Boolean))];
      setServices(uniqueServices.sort());
      setStatuses(uniqueStatuses.sort());
      
      // Initially show all events
      setFilteredEvents(data.events);
      console.log('🔍 DrillDownDetail set filteredEvents:', data.events.length);
    } else {
      console.log('🔍 DrillDownDetail no events in data:', data);
    }
  }, [data]);

  const applyFilters = useCallback(() => {
    console.log('🔍 DrillDownDetail applyFilters called with data:', data?.events?.length, 'filters:', filters);
    if (!data?.events) return;
    
    let filtered = [...data.events];

    if (filters.services.length > 0 && !filters.services.includes('')) {
      filtered = filtered.filter(event => filters.services.includes(event.service));
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes('')) {
      filtered = filtered.filter(event => filters.statuses.includes(event.status_code));
    }

    if (filters.startDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.start_time || event.last_update);
        return eventDate >= new Date(filters.startDate);
      });
    }

    if (filters.endDate) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.start_time || event.last_update);
        return eventDate <= new Date(filters.endDate + 'T23:59:59');
      });
    }

    console.log('🔍 DrillDownDetail applyFilters result:', filtered.length);
    setFilteredEvents(filtered);
  }, [data, filters]);

  useEffect(() => {
    if (data?.events) {
      applyFilters();
    }
  }, [data, filters, applyFilters]);

  const handleFilterChange = (filterType, value) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));
  };

  const exportToExcel = () => {
    const csvData = [];
    
    // Add header row
    csvData.push(['Account', 'Service', 'Event Category', 'Description', 'Risk', 'Status', 'Start Time', 'End Time']);
    
    // Add data rows
    filteredEvents.forEach(event => {
      csvData.push([
        event.account || 'N/A',
        event.service || 'N/A',
        event.eventCategory || 'N/A',
        event.description || 'N/A',
        event.risk || 'N/A',
        event.status_code || 'N/A',
        event.start_time || 'N/A',
        event.end_time || 'N/A'
      ]);
    });
    
    // Convert to CSV string
    const csvContent = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `drill_down_details_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDateTime = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return ''; // Return blank for invalid dates
    return date.toLocaleString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeZoneName: 'short'
    });
  };

  const generateDynamicHeader = () => {
    if (!data?.filters) return 'Drill-Down Details';
    
    const filterParts = [];
    if (data.filters.account) filterParts.push(`Account: ${data.filters.account}`);
    if (data.filters.region) filterParts.push(`Region: ${data.filters.region}`);
    if (data.filters.eventCategory) filterParts.push(`Category: ${data.filters.eventCategory}`);
    if (data.filters.service) filterParts.push(`Service: ${data.filters.service}`);
    if (data.filters.status_code) filterParts.push(`Status: ${data.filters.status_code}`);
    
    return filterParts.length > 0 ? `Drill-Down Details - ${filterParts.join(', ')}` : 'Drill-Down Details';
  };

  return (
    <div className="detail-view">
      <div className="detail-header">
        <div>
          <h1 className="detail-main-title">AWS Health Event Drill-Down</h1>
          <h2 className="detail-category-title">{generateDynamicHeader()}</h2>
          {data?.timestamp && (
            <div className="last-updated">
              Data retrieved at {new Date(data.timestamp).toLocaleString()} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </div>
          )}
        </div>
        <div className="header-buttons">
          <button className="export-button" onClick={exportToExcel}>
            📊 Export to Excel
          </button>
          <button className="back-button" onClick={onBack}>
            ← Back to Analysis
          </button>
        </div>
      </div>

      {data?.loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading drill-down details...</p>
        </div>
      ) : data?.error ? (
        <div className="error-container">
          <p className="error-message">Error: {data.error}</p>
        </div>
      ) : (
        <>
          <div className="filters-section">
            <div className="filter-row">
              <div className="filter-group">
                <label>Additional Service Filter:</label>
                <select 
                  multiple 
                  value={filters.services}
                  onChange={(e) => handleFilterChange('services', Array.from(e.target.selectedOptions, option => option.value))}
                  className="multi-select"
                >
                  <option value="">ALL</option>
                  {services.map(service => (
                    <option key={service} value={service}>{service}</option>
                  ))}
                </select>
              </div>
              
              <div className="filter-group">
                <label>Additional Status Filter:</label>
                <select 
                  multiple 
                  value={filters.statuses}
                  onChange={(e) => handleFilterChange('statuses', Array.from(e.target.selectedOptions, option => option.value))}
                  className="multi-select"
                >
                  <option value="">ALL</option>
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              
              <div className="filter-group">
                <label>Start Date:</label>
                <input 
                  type="date" 
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                />
              </div>
              
              <div className="filter-group">
                <label>End Date:</label>
                <input 
                  type="date" 
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="events-table-container">
            <div className="summary-stats">
              <p>Showing {filteredEvents.length} of {data?.count || 0} events</p>
            </div>
            
            {filteredEvents.length === 0 ? (
              <div className="empty-state">
                <p>No events found matching the selected criteria.</p>
              </div>
            ) : (
              <table className="events-table">
                <thead className="table-header">
                  <tr>
                    <th className="col-account">Account</th>
                    <th className="col-service">Service</th>
                    <th className="col-category">Event Category</th>
                    <th className="col-description">Description</th>
                    <th className="col-risk">Risk</th>
                    <th className="col-status">Status</th>
                    <th className="col-start-time">Start Time</th>
                    <th className="col-end-time">End Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event, index) => {
                    const description = event.description || 'N/A';
                    const truncatedDescription = description.length > 150 ? description.substring(0, 150) + '...' : description;
                    
                    return (
                      <tr key={index} className={`table-row ${index % 2 === 0 ? 'even' : 'odd'}`}>
                        <td className="col-account" title={event.account || 'N/A'}>{event.account || 'N/A'}</td>
                        <td className="col-service" title={event.service || 'N/A'}>{event.service || 'N/A'}</td>
                        <td className="col-category" title={event.eventCategory || 'N/A'}>{event.eventCategory || 'N/A'}</td>
                        <td className="col-description" title={description}>{truncatedDescription}</td>
                        <td className="col-risk" title={event.risk || 'N/A'}>{event.risk || 'N/A'}</td>
                        <td className="col-status" title={event.status_code || 'N/A'}>{event.status_code || 'N/A'}</td>
                        <td className="col-start-time" title={formatDateTime(event.start_time)}>{formatDateTime(event.start_time)}</td>
                        <td className="col-end-time" title={formatDateTime(event.end_time)}>{formatDateTime(event.end_time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AgenticDiagnosticsView({ onBack, analysisResults, setAnalysisResults }) {
  console.log('AgenticDiagnosticsView mounted/rendered with analysisResults:', analysisResults.length);
  const [promptText, setPromptText] = useState('');
  const [cachedPrompts, setCachedPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streamingUpdates, setStreamingUpdates] = useState([]);
  const [resultAdded, setResultAdded] = useState(false);
  const resultAddedRef = useRef(false);
  const currentSubmissionRef = useRef(null);

  const handleFollowUpClick = (question) => {
    setPromptText(question);
  };

  useEffect(() => {
    fetchCachedPrompts();
  }, []);

  useEffect(() => {
    // Add click handlers to follow-up questions in analysis results
    const addClickHandlers = () => {
      const followUpElements = document.querySelectorAll('.analysis-content p, .analysis-content li');
      followUpElements.forEach(element => {
        const text = element.textContent;
        if (text && (text.includes('Follow-up Question:') || text.includes('?'))) {
          const questionMatch = text.match(/Follow-up Question:\s*(.+?)(?:\n|$)/i) || 
                               text.match(/^\d+\.\s*(.+\?)/) ||
                               (text.includes('?') ? [null, text.trim()] : null);
          
          if (questionMatch && questionMatch[1]) {
            element.style.cursor = 'pointer';
            element.style.color = '#007bff';
            element.style.textDecoration = 'underline';
            element.onclick = () => handleFollowUpClick(questionMatch[1].trim());
          }
        }
      });
    };

    // Run after DOM updates
    setTimeout(addClickHandlers, 100);
  }, [analysisResults]);

  const fetchCachedPrompts = async () => {
    try {
      const response = await fetch('/api/cached-prompts');
      const data = await response.json();
      setCachedPrompts(data.prompts || []);
    } catch (error) {
      console.error('Error fetching cached prompts:', error);
    }
  };

  // Single function to add results - prevents all duplicates
  const addAnalysisResult = (submissionId, prompt, response, source = 'unknown') => {
    console.log(`🔍 addAnalysisResult called - Source: ${source}, ID: ${submissionId}, resultAddedRef: ${resultAddedRef.current}, currentSubmission: ${currentSubmissionRef.current}`);
    
    if (resultAddedRef.current || currentSubmissionRef.current !== submissionId) {
      console.log(`🚫 Result addition blocked - already added or wrong submission. Source: ${source}, ID: ${submissionId}`);
      return false;
    }
    
    console.log(`✅ ALLOWING result addition from ${source}, ID: ${submissionId}`);
    console.log(`📝 Response length: ${response.length} characters`);
    console.log(`📝 Response preview: ${response.substring(0, 200)}...`);
    
    // Check if the response contains duplicate content
    const responseLines = response.split('\n');
    const uniqueLines = [...new Set(responseLines)];
    console.log(`📊 Total lines: ${responseLines.length}, Unique lines: ${uniqueLines.length}`);
    
    resultAddedRef.current = true;
    setResultAdded(true);
    
    const newResult = {
      id: submissionId,
      prompt: prompt,
      response: response,
      timestamp: new Date().toLocaleString(),
      source: source,
      debugId: `${Date.now()}-${Math.random()}`
    };
    
    setAnalysisResults(prev => {
      // Final duplicate check by ID
      const exists = prev.some(result => result.id === submissionId);
      if (exists) {
        console.log(`🚫 Final duplicate check prevented result from ${source}, ID: ${submissionId}`);
        return prev;
      }
      console.log(`✅ Adding result from ${source}, current count: ${prev.length}, ID: ${submissionId}`);
      return [newResult, ...prev];
    });
    
    return true;
  };

  const handleSubmit = async () => {
    if (!promptText.trim()) return;
    
    console.log(`🚀 handleSubmit called - creating submission ID`);
    
    setLoading(true);
    setStreamingUpdates([]);
    setResultAdded(false);
    resultAddedRef.current = false; // Reset ref
    
    // Create a unique submission ID to prevent duplicates
    const submissionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const currentPrompt = promptText; // Save prompt immediately
    currentSubmissionRef.current = submissionId; // Track current submission
    
    console.log(`🆔 Created submission ID: ${submissionId} for prompt: "${currentPrompt.substring(0, 50)}..."`);
    console.log(`🔄 Reset refs - resultAddedRef: ${resultAddedRef.current}, currentSubmissionRef: ${currentSubmissionRef.current}`);
    
    // Add initial status message
    setStreamingUpdates([{ 
      type: 'info', 
      message: '🔌 Connecting to agent analysis service...',
      timestamp: new Date().toLocaleTimeString()
    }]);
    
    try {
      // Connect to WebSocket for real-time updates
      console.log(`🔌 Creating NEW WebSocket connection for submission: ${submissionId}`);
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.hostname;
      const wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const ws = new WebSocket(`${wsProtocol}//${wsHost}:${wsPort}`);
      let wsConnected = false;
      
      ws.onopen = () => {
        console.log('🔌 WebSocket connected for agent analysis');
        wsConnected = true;
        setStreamingUpdates(prev => [...prev, { 
          type: 'info', 
          message: '✅ Connected to real-time analysis stream',
          timestamp: new Date().toLocaleTimeString()
        }]);
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('📡 Agent WebSocket message TYPE:', data.type, 'resultAddedRef.current:', resultAddedRef.current);
        
        if (data.type === 'agent_started') {
          setStreamingUpdates(prev => [...prev, { 
            type: 'info', 
            message: data.message,
            timestamp: new Date().toLocaleTimeString()
          }]);
        } else if (data.type === 'agent_progress') {
          setStreamingUpdates(prev => [...prev, { 
            type: 'progress', 
            message: data.message,
            timestamp: data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()
          }]);
        } else if (data.type === 'agent_output') {
          console.log('🎯 Processing agent_output, attempting to add result from WebSocket');
          
          if (addAnalysisResult(submissionId, currentPrompt, data.message, 'WebSocket')) {
            setStreamingUpdates([]); // Clear streaming updates
            setLoading(false);
            ws.analysisCompleted = true; // Mark as completed before closing
            ws.close();
            
            // Update cached prompts after successful submission
            fetchCachedPrompts();
            setPromptText('');
          }
        } else if (data.type === 'agent_complete') {
          // Just ensure loading is stopped, don't create duplicate results
          setLoading(false);
          ws.analysisCompleted = true; // Mark as completed before closing
          ws.close();
          
          // Update cached prompts after successful submission
          fetchCachedPrompts();
          setPromptText('');
        } else if (data.type === 'throttling_error') {
          setStreamingUpdates(prev => [...prev, { 
            type: 'warning', 
            message: 'Rate limiting detected - please wait before retrying',
            timestamp: new Date().toLocaleTimeString()
          }]);
          // Don't close connection or stop loading - throttling might be temporary
        } else if (data.type === 'agent_error' || data.type === 'agent_failed') {
          setStreamingUpdates(prev => [...prev, { 
            type: 'error', 
            message: data.message || 'Agent analysis failed',
            timestamp: new Date().toLocaleTimeString()
          }]);
          // Don't set loading to false or close WebSocket - let it continue in case analysis recovers
        }
      };
      
      ws.onclose = () => {
        console.log('🔌 Agent WebSocket disconnected');
        console.log('🔍 analysisCompleted:', ws.analysisCompleted);
        console.log('🔍 Should trigger fallback:', !ws.analysisCompleted);
        
        // Only show fallback if analysis wasn't completed normally
        if (!ws.analysisCompleted) {
          setStreamingUpdates(prev => [...prev, { 
            type: 'info', 
            message: '🔌 Connection lost - checking for completed analysis...',
            timestamp: new Date().toLocaleTimeString()
          }]);
          
          // Wait briefly then check server logs for final response
          setTimeout(() => {
            if (loading) {
              // Try to get the final response from server logs
              fetch('/api/get-last-response', { method: 'GET' })
                .then(response => response.json())
                .then(data => {
                  if (data.response && data.response.length > 100 && !resultAddedRef.current) {
                    // Show popup with the response
                    const popup = window.open('', 'Analysis Result', 'width=800,height=600,scrollbars=yes');
                    popup.document.write(`
                      <html>
                        <head><title>Analysis Result</title></head>
                        <body style="font-family: Arial, sans-serif; padding: 20px;">
                          <h2>Analysis Completed (WebSocket Disconnected)</h2>
                          <p><strong>Query:</strong> ${promptText}</p>
                          <hr>
                          ${data.response}
                        </body>
                      </html>
                    `);
                    popup.document.close();
                    
                    // Also add to results only if not already added
                    console.log('🎯 WebSocket close handler attempting to add result');
                    addAnalysisResult(submissionId, currentPrompt, data.response, 'WebSocket Close Handler');
                  } else {
                    // Fallback to regular method
                    handleFallbackSubmit(submissionId, currentPrompt);
                  }
                })
                .catch(() => {
                  // Fallback if server endpoint doesn't exist
                  handleFallbackSubmit(submissionId, currentPrompt);
                });
              
              setLoading(false);
            }
          }, 3000);
        }
      };
      
      ws.onerror = (error) => {
        console.error('🔌 Agent WebSocket error:', error);
        setStreamingUpdates(prev => [...prev, { 
          type: 'error', 
          message: '❌ WebSocket connection failed - trying fallback method',
          timestamp: new Date().toLocaleTimeString()
        }]);
        
        // Fallback to non-streaming endpoint
        setTimeout(() => {
          if (loading) {
            handleFallbackSubmit(submissionId, currentPrompt);
          }
        }, 1000);
      };
      
      // Add connection timeout
      setTimeout(() => {
        if (!wsConnected && loading) {
          setStreamingUpdates(prev => [...prev, { 
            type: 'warning', 
            message: '⚠️ WebSocket connection timeout - using fallback method',
            timestamp: new Date().toLocaleTimeString()
          }]);
          ws.close();
          handleFallbackSubmit(submissionId, currentPrompt);
        }
      }, 120000);
      
      // Start the streaming analysis
      const response = await fetch('/api/agent-analysis-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to start analysis');
      }
      
    } catch (error) {
      console.error('Error submitting prompt:', error);
      setStreamingUpdates(prev => [...prev, { 
        type: 'error', 
        message: `❌ Error: ${error.message}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
      
      // Try fallback method
      handleFallbackSubmit(submissionId, currentPrompt);
    }
  };

  const handleFallbackSubmit = async (submissionId, currentPrompt) => {
    try {
      setStreamingUpdates(prev => [...prev, { 
        type: 'info', 
        message: '🔄 Using fallback analysis method...',
        timestamp: new Date().toLocaleTimeString()
      }]);
      
      const response = await fetch('/api/agent-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        console.log('🎯 Fallback method attempting to add result');
        if (addAnalysisResult(submissionId, result.prompt || currentPrompt, result.analysis, 'Fallback Method')) {
          setPromptText('');
          fetchCachedPrompts();
          
          setStreamingUpdates(prev => [...prev, { 
            type: 'success', 
            message: '✅ Fallback analysis completed!',
            timestamp: new Date().toLocaleTimeString()
          }]);
        }
      } else {
        throw new Error(result.error || 'Analysis failed');
      }
    } catch (error) {
      setStreamingUpdates(prev => [...prev, { 
        type: 'error', 
        message: `❌ Fallback failed: ${error.message}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePromptClick = (prompt) => {
    if (!loading) {
      setPromptText(prompt.text);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit();
    }
  };

  return (
    <div className="agentic-diagnostics-view">
      <div className="detail-header">
        <h2 className="detail-title">🔬 AI Agents Diagnostics</h2>
        <button className="back-button" onClick={onBack}>
          ← Back to Overview
        </button>
      </div>

      <div className="agent-analysis-section">
        <h3>Agent Analysis</h3>
        <div className="agent-layout-container">
          {/* Left Column - Input and Results */}
          <div className="agent-left-column">
            <div className="prompt-input-container">
              <textarea
                className="agent-prompt-input"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Enter your prompt for AI agent analysis... (Ctrl+Enter to submit)"
                rows={8}
                disabled={loading}
              />
              <button 
                className="submit-prompt-button"
                onClick={(e) => {
                  e.preventDefault();
                  if (!loading && promptText.trim()) {
                    handleSubmit();
                  }
                }}
                disabled={loading || !promptText.trim()}
                title="Submit prompt for analysis"
              >
                {loading ? '🔄 Processing...' : '▶️ Analyze'}
              </button>
            </div>
            
            {/* Persistent Analysis Results */}
            <div className="persistent-results-container">
              <h4>📊 Analysis History ({analysisResults.length})</h4>
              <div className="results-scroll-container">

                {analysisResults.map((result, index) => (
                  <div key={result.id} className="analysis-result-item">
                    <div className="result-header">
                      <strong style={{color: '#28a745'}}>Query:</strong> <span style={{color: '#28a745'}}>{result.prompt}</span>
                      <span className="result-timestamp" style={{color: '#28a745'}}>{result.timestamp}</span>

                    </div>
                    <div className="result-content">
                      <div 
                        dangerouslySetInnerHTML={{ __html: result.response }}
                        className="analysis-content"
                      />
                    </div>
                  </div>
                ))}
                {analysisResults.length === 0 && (
                  <div className="no-results">No analysis results yet. Submit a query to get started.</div>
                )}
              </div>
            </div>
          </div>
          
          {/* Right Column - Suggested Prompts */}
          <div className="agent-right-column">
            <div className="suggested-prompts-section">
              <h4>💡 Suggested Prompts</h4>
              <div className="suggested-prompts-container">
                {cachedPrompts
                  .filter(prompt => prompt.category !== 'user-generated')
                  .concat(
                    cachedPrompts
                      .filter(prompt => prompt.category === 'user-generated')
                      .sort((a, b) => b.usage_count - a.usage_count)
                      .slice(0, 15)
                  )
                  .slice(0, 15)
                  .map((prompt, index) => (
                  <div 
                    key={prompt.id} 
                    className={`suggested-prompt-item ${loading ? 'disabled' : ''}`}
                    onClick={() => handlePromptClick(prompt)}
                    title={loading ? 'Please wait for current analysis to complete' : 'Click to use this prompt'}
                  >
                    <div className="prompt-text">{prompt.text}</div>
                    <div className="prompt-meta">
                      <span className="usage-count">Used {prompt.usage_count} times</span>
                      <span className="last-used">
                        {prompt.category === 'user-generated' 
                          ? `Last: ${new Date(prompt.last_used).toLocaleDateString()}`
                          : 'Generic'
                        }
                      </span>
                    </div>
                  </div>
                ))}
                {cachedPrompts.length === 0 && (
                  <div className="no-prompts">No suggested prompts available yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Processing Status */}
        {loading && (
          <div className="processing-status">
            <div className="loading-spinner"></div>
            <p>🤖 Agent is processing your request...</p>
            <p className="processing-details">
              {streamingUpdates.length === 0 
                ? "Initializing connection..." 
                : "Receiving real-time updates below ↓"
              }
            </p>
          </div>
        )}
        
      </div>


    </div>
  );
}

export default App;
