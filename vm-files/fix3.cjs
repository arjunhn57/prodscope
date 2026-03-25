const fs = require('fs');
const filePath = 'C:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\index.cjs';
if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>>.*?\r?\n/g;
  content = content.replace(conflictRegex, (match, headBlock, incomingBlock) => {
    return incomingBlock; // keeping incoming changes
  });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed index.cjs');
} else {
  console.log('index.cjs not found');
}
