const fs = require('fs');

function fixFile(filePath, keepHead) {
  let content = fs.readFileSync(filePath, 'utf8');
  const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>>.*?\r?\n/g;
  
  content = content.replace(conflictRegex, (match, headBlock, incomingBlock) => {
    return keepHead ? headBlock : incomingBlock;
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed ${filePath}`);
}

// 1. package.json doesn't matter much since HEAD and incoming were identical in dependencies, 
// but we will keep HEAD for package.json to be safe with name/version.
fixFile('prodscope-backend-live/package.json', true);
fixFile('prodscope-backend-live/package-lock.json', true);
fixFile('prodscope-backend-live/index.js', false);
fixFile('prodscope-backend-live/crawler/forms.js', false);

// 2. actions.js: we want the WIP branch (incoming) which has the dense ranking logic
fixFile('prodscope-backend-live/crawler/actions.js', false);

// 3. run.js: we want the WIP branch (incoming)
fixFile('prodscope-backend-live/crawler/run.js', false);

// Now apply specific fixes to run.js
let runJs = fs.readFileSync('prodscope-backend-live/crawler/run.js', 'utf8');
runJs = runJs.replace(/maxSteps\s*=\s*40/, 'maxSteps = 20');

// Remove duplicate isUtilityOverlayScreen
const overlayFuncRegex = /function isUtilityOverlayScreen\(xml\) \{[\s\S]*?return \([\s\S]*?\);\s*\}/g;
let matchCount = 0;
runJs = runJs.replace(overlayFuncRegex, (match) => {
  matchCount++;
  if (matchCount === 2) {
    return ''; // Remove the second one
  }
  return match;
});

fs.writeFileSync('prodscope-backend-live/crawler/run.js', runJs, 'utf8');
console.log('Applied specific fixes to run.js');
