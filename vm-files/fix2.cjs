const fs = require('fs');

function fixFile(filePath, keepHead) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>>.*?\r?\n/g;
  
  content = content.replace(conflictRegex, (match, headBlock, incomingBlock) => {
    return keepHead ? headBlock : incomingBlock;
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed ${filePath}`);
}

const filesToFixWip = [
  'prodscope-backend-live/crawler/screen.js',
  'prodscope-backend-live/crawler/adb.js',
  'prodscope-backend-live/crawler/fingerprint.js',
  'prodscope-backend-live/crawler/system-handlers.js',
  'prodscope-backend-live/crawler/__tests__/fingerprint.test.js'
];

filesToFixWip.forEach(f => fixFile(f, false));
