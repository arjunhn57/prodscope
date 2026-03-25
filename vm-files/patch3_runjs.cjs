const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

// The block we currently have in run.js is:
/*
    const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      primaryPackage === packageName;
*/

// Let's replace it with a looser check:
// Wait, primaryPackage is evaluated per screen capture: `const primaryPackage = uiHelper.getPrimaryPackage(snapshot.xml);`
// On step 13, primary package WAS com.biztoso.app. And packageName is the argument (also com.biztoso.app).
// Why did 'primaryPackage === packageName' fail?
// Let's inspect scope. Maybe it's `getPrimaryPackage` instead of a variable?
// No, line 142 prints `Primary package: com.biztoso.app`.
// Ah! The log says: 
//   [crawler] Primary package: com.biztoso.app
//   [crawler] Executed: press_back (reason: max_revisits_exceeded)
// BUT wait. Look at Step 13:
//   142: [crawler] Primary package: com.biztoso.app
//   152: [crawler] Primary package: com.google.android.apps.nexuslauncher
// Let's check run.js context. 
// Just to be absolutely safe, let's remove the primaryPackage === packageName condition entirely, since getting stuck in a loop inside *any* package and backing out is bad if we expect to stay in `packageName`.
// Actually, the user asked for: `primaryPackage === packageName`. Wait, `primaryPackage` might be out of scope or named differently where I hooked it.

const hookTarget = `const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      primaryPackage === packageName;`;

const hookReplacement = `const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      (typeof primaryPackage !== 'undefined' ? primaryPackage === packageName : true);`;

if (content.includes(hookTarget)) {
    content = content.replace(hookTarget, hookReplacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Updated check.");
} else {
    console.log("Target not found!");
}
