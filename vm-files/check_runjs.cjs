const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

// The replacement was:
// const shouldSubstituteRecoveryRelaunch = ...
// But it seems we missed it or it didn't trigger because primaryPackage wasn't correctly matched
// Wait, primaryPackage is a local variable but maybe we used the right name?
// Let's search & replace again, printing the exact reason to console for debug, and fixing the hook.

const hookSearch = "const description = executeAction(decision.action);";

// In the previous step, I replaced the single line hookSearch with:
// const shouldSubstituteRecoveryRelaunch = ...
// const description = executeAction(decision.action);
// So the hookSearch is STILL there. Let's replace the whole block we inserted previously.

const oldRecoveryBlock = `const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      primaryPackage === packageName;

    if (shouldSubstituteRecoveryRelaunch) {
      console.log(\`  [crawler] Recovery BACK blocked inside app; relaunching \${packageName} instead\`);

      adb.launchApp(packageName);

      actionsTaken.push({
        step,
        type: 'relaunch',
        description: \`relaunch(\${packageName})\`,
        reason: \`recovery_substitute_for_\${decision.reason}\`,
        actionKey: \`relaunch_\${packageName}\`,
        fromFingerprint: fp,
      });

      await sleep(2000);
      continue;
    }

    const description = executeAction(decision.action);`;

const newRecoveryBlock = `const shouldSubstituteRecoveryRelaunch =
      decision?.action?.type === actions.ACTION_TYPES.BACK &&
      ['loop_detected', 'max_revisits_exceeded', 'all_actions_exhausted'].includes(decision.reason) &&
      primaryPackage === packageName;

    if (shouldSubstituteRecoveryRelaunch) {
      console.log(\`  [crawler] Recovery BACK blocked inside app; relaunching \${packageName} instead\`);

      adb.launchApp(packageName);

      actionsTaken.push({
        step,
        type: 'relaunch',
        description: \`relaunch(\${packageName})\`,
        reason: \`recovery_substitute_for_\${decision.reason}\`,
        actionKey: \`relaunch_\${packageName}\`,
        fromFingerprint: fp,
      });

      await sleep(2000);
      continue;
    }

    const description = executeAction(decision.action);`;

// If you examine the regex in fix_runjs.cjs, maybe it didn't match perfectly.
// Let's do a brute force replace using string split and join.

content = content.split(oldRecoveryBlock).join(hookSearch); // Revert first if applied

// Wait, the log:
// [policy] Screen visited 5 times — backtracking
//   [crawler] Executed: press_back (reason: max_revisits_exceeded)
// This means decision.reason === 'max_revisits_exceeded' and action.type === 'back'. But wait, primaryPackage?
// In Step 13, Primary package: com.biztoso.app. So primaryPackage === packageName is TRUE.
// Why did the block not fire? Let's check if the replacement actually succeeded previously.

// Let's just output the lines around executeAction to verify.
