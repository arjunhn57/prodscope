const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

const hookTarget = `const currentPackage = uiHelper.getPrimaryPackage(snapshot.xml) || '';
    const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      currentPackage === packageName;`;

// Wait, the log file (app6.log) is identical to app5.log.
// The crawler ran 17 steps and then exited gracefully due to no_new_states.
// But wait, look at step 13!
// 148:   [policy] Screen visited 5 times — backtracking
// 149:   [crawler] Executed: press_back (reason: max_revisits_exceeded)
// It STILL executed press_back.
// That means the interception STILL did not happen, or was bypassed.
// Why did the server crash on curl? 
// No, looking closely, `curl: (7) Failed to connect` was the error on the client. The server might have hung or closed early due to a syntax issue. 
// Wait, in Step 586: "ues:82:21)w-body/index.js:287:7)ct } at IncomingMessage.emit (node:events:524:28)"
// That is an HTTP payload parsing error in the backend!
// The backend is dropping connections. BUT the crawl actually happened.
// Why did the crawl not trigger my hook?
// "decision?.action?.type === actions.ACTION_TYPES.BACK"
// Wait. Is the action type exactly `actions.ACTION_TYPES.BACK`?
// `press_back` action types are actually just `'back'`. Let's check actions.js. ACTION_TYPES.BACK might be 'back'.
// Wait! `decision.action.type` is 'back'.
// `currentPackage` === packageName : com.biztoso.app === com.biztoso.app (true)
// `decision.reason` in [...] is true.
// Does the hook code exist exactly where executeAction is called?
// Let's replace the hook to be absolutely foolproof and log *why* it rejects it.

const hookReplacement = `
    const currentPackage = (typeof uiHelper !== 'undefined') ? (uiHelper.getPrimaryPackage(snapshot.xml) || '') : '';
    const pM = currentPackage === packageName;
    const tM = decision?.action?.type === 'back' || decision?.action?.type === actions.ACTION_TYPES.BACK;
    const rM = ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason);
    
    // console.log(\`[DEBUG] Intercept Evaluator - pkgMatch:\${pM} (\${currentPackage}==\${packageName}) typeMatch:\${tM} (\${decision?.action?.type}) reasonMatch:\${rM} (\${decision.reason})\`);

    const shouldSubstituteRecoveryRelaunch = tM && rM && pM;
`;

if (content.includes(hookTarget)) {
    content = content.replace(hookTarget, hookReplacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Updated intercept check.");
} else {
    console.log("Hook target not found for replacement.");
}
