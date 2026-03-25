const { runCrawl } = require('./crawler/run.js');
const path = require('path');
const fs = require('fs');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting test crawl...');
  const screenshotDir = '/tmp/test-screenshots';
  if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const result = await runCrawl({
    screenshotDir,
    packageName: 'com.biztoso.app',
    maxSteps: 20,
    credentials: { email: 'test@test.com', password: 'test' },
    onProgress: (s, t) => console.log(`Step ${s}/${t}`)
  });
  console.log('Crawl finished:', result.stopReason);
}
main().catch(error => {
    console.error('Crawl failed:', error);
    process.exit(1);
});
