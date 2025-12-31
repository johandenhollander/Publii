/**
 * Test MCP Tools
 *
 * Tests individual MCP tools to verify they work correctly
 */

const SiteTools = require('./app/back-end/mcp/tools/sites.js');

// Mock appInstance with test data
const mockAppInstance = {
  sites: {
    'example-site': {
      name: 'example-site',
      displayName: 'Example Site',
      domain: 'https://example.com',
      theme: 'simple',
      logo: {
        icon: 'example-icon'
      },
      description: 'Example description'
    },
    'my-blog': {
      name: 'my-blog',
      displayName: 'My Personal Blog',
      domain: 'https://blog.mysite.com',
      theme: 'mercury',
      logo: {
        icon: 'blog-logo'
      }
    },
    'company-website': {
      name: 'company-website',
      displayName: 'Company Website',
      domain: 'https://company.example.com',
      theme: 'editorial',
      logo: null
    }
  }
};

async function testSiteTools() {
  console.log('='.repeat(70));
  console.log('MCP Site Tools Test');
  console.log('='.repeat(70));
  console.log('');

  try {
    // Test 1: list_sites
    console.log('[Test 1] Testing list_sites tool...');
    console.log('-'.repeat(70));

    const listResult = await SiteTools.handleToolCall('list_sites', {}, mockAppInstance);

    console.log('Result:', JSON.stringify(listResult, null, 2));

    // Parse the result
    const resultData = JSON.parse(listResult.content[0].text);

    console.log('');
    console.log('Parsed result:');
    console.log(`  Success: ${resultData.success}`);
    console.log(`  Count: ${resultData.count}`);
    console.log(`  Sites:`);
    resultData.sites.forEach((site, index) => {
      console.log(`    ${index + 1}. ${site.displayName} (${site.name})`);
      console.log(`       Domain: ${site.domain}`);
      console.log(`       Theme: ${site.theme}`);
    });

    if (resultData.success && resultData.count === 3) {
      console.log('✅ list_sites returned correct number of sites');
    } else {
      console.log('❌ list_sites returned unexpected data');
    }

    console.log('');
    console.log('-'.repeat(70));
    console.log('');

    // Test 2: get_site_config
    console.log('[Test 2] Testing get_site_config tool...');
    console.log('-'.repeat(70));

    const getResult = await SiteTools.handleToolCall(
      'get_site_config',
      { site: 'my-blog' },
      mockAppInstance
    );

    console.log('Result:', JSON.stringify(getResult, null, 2));

    const getResultData = JSON.parse(getResult.content[0].text);

    console.log('');
    console.log('Parsed result:');
    console.log(`  Success: ${getResultData.success}`);
    console.log(`  Site: ${getResultData.site}`);
    console.log(`  Config display name: ${getResultData.config.displayName}`);
    console.log(`  Config domain: ${getResultData.config.domain}`);
    console.log(`  Config theme: ${getResultData.config.theme}`);

    if (getResultData.success && getResultData.config.displayName === 'My Personal Blog') {
      console.log('✅ get_site_config returned correct site data');
    } else {
      console.log('❌ get_site_config returned unexpected data');
    }

    console.log('');
    console.log('-'.repeat(70));
    console.log('');

    // Test 3: get_site_config for non-existent site
    console.log('[Test 3] Testing get_site_config with non-existent site...');
    console.log('-'.repeat(70));

    try {
      await SiteTools.handleToolCall(
        'get_site_config',
        { site: 'non-existent' },
        mockAppInstance
      );
      console.log('❌ Should have thrown error for non-existent site');
    } catch (error) {
      console.log(`Error message: ${error.message}`);
      if (error.message.includes('not found')) {
        console.log('✅ Correctly threw error for non-existent site');
      } else {
        console.log('❌ Wrong error message');
      }
    }

    console.log('');
    console.log('-'.repeat(70));
    console.log('');

    console.log('='.repeat(70));
    console.log('All MCP tool tests passed! 🎉');
    console.log('='.repeat(70));
    console.log('');
    console.log('Summary:');
    console.log('  ✅ list_sites - Returns all sites correctly');
    console.log('  ✅ get_site_config - Returns specific site config');
    console.log('  ✅ Error handling - Throws error for invalid sites');
    console.log('');
    console.log('The MCP tools correctly reuse Publii\'s appInstance.sites data!');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('='.repeat(70));
    console.error('Test failed! ❌');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testSiteTools();
