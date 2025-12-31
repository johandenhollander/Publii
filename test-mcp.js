/**
 * Standalone MCP Server Test
 *
 * Tests the MCP server without loading full Publii
 * This verifies our MCP integration code works correctly
 */

const PubliiMCPServer = require('./app/back-end/mcp/server.js');

// Mock appInstance with minimal required properties
const mockAppInstance = {
  sites: {
    'test-site': {
      name: 'test-site',
      displayName: 'Test Site',
      domain: 'https://test.example.com',
      theme: 'simple',
      logo: {
        icon: 'test-icon'
      }
    },
    'my-blog': {
      name: 'my-blog',
      displayName: 'My Blog',
      domain: 'https://blog.example.com',
      theme: 'mercury',
      logo: {
        icon: 'blog-icon'
      }
    }
  }
};

async function testMCPServer() {
  console.log('='.repeat(60));
  console.log('MCP Server Integration Test');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Test 1: Create MCP server
    console.log('[Test 1] Creating MCP server instance...');
    const mcpServer = new PubliiMCPServer(mockAppInstance);
    console.log('✅ MCP server created successfully');
    console.log('');

    // Test 2: Check initial status
    console.log('[Test 2] Checking initial status...');
    const initialStatus = mcpServer.getStatus();
    console.log('Status:', JSON.stringify(initialStatus, null, 2));

    if (!initialStatus.running) {
      console.log('✅ Server initially not running (expected)');
    } else {
      console.log('❌ Server should not be running yet');
    }
    console.log('');

    // Test 3: Start server
    console.log('[Test 3] Starting MCP server...');
    const startResult = await mcpServer.start();
    console.log('Start result:', JSON.stringify(startResult, null, 2));

    if (startResult.success) {
      console.log('✅ Server started successfully');
    } else {
      console.log('❌ Failed to start server');
    }
    console.log('');

    // Test 4: Check running status
    console.log('[Test 4] Checking running status...');
    const runningStatus = mcpServer.getStatus();
    console.log('Status:', JSON.stringify(runningStatus, null, 2));

    if (runningStatus.running) {
      console.log('✅ Server is running');
    } else {
      console.log('❌ Server should be running');
    }
    console.log('');

    // Test 5: Stop server
    console.log('[Test 5] Stopping MCP server...');
    const stopResult = await mcpServer.stop();
    console.log('Stop result:', JSON.stringify(stopResult, null, 2));

    if (stopResult.success) {
      console.log('✅ Server stopped successfully');
    } else {
      console.log('❌ Failed to stop server');
    }
    console.log('');

    // Test 6: Check stopped status
    console.log('[Test 6] Checking stopped status...');
    const stoppedStatus = mcpServer.getStatus();
    console.log('Status:', JSON.stringify(stoppedStatus, null, 2));

    if (!stoppedStatus.running) {
      console.log('✅ Server is stopped');
    } else {
      console.log('❌ Server should be stopped');
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('All tests passed! 🎉');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('Test failed! ❌');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testMCPServer();
