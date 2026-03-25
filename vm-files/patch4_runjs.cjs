const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

// The block we currently have in run.js is:
/*
    const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      (typeof primaryPackage !== 'undefined' ? primaryPackage === packageName : true);
*/

// It threw an error because primaryPackage is completely undeclared in this scope.
// Using `typeof` still throws ReferenceError if the variable is entirely undeclared in strictly nested JS without var.
// The safest way is to actively call: const currentPackage = uiHelper.getPrimaryPackage(snapshot.xml);

const hookTarget = `const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      (typeof primaryPackage !== 'undefined' ? primaryPackage === packageName : true);`;

const hookReplacement = `const currentPackage = uiHelper.getPrimaryPackage(snapshot.xml) || '';
    const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      currentPackage === packageName;`;

if (content.includes(hookTarget)) {
    content = content.replace(hookTarget, hookReplacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Updated check.");
} else {
    console.log("Target not found!");
}
