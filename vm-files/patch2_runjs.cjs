const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

// The hook we need to replace is around line 755:
// const description = executeAction(decision.action);
// console.log(`  [crawler] Executed: ${description} (reason: ${decision.reason})`);

const hookSearch = "const description = executeAction(decision.action);";
const fullHookSearch = "    const description = executeAction(decision.action);\\n    console.log(`  [crawler] Executed: ${description} (reason: ${decision.reason})`);";

const recoveryCode = `const shouldSubstituteRecoveryRelaunch =
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

if (content.includes(hookSearch)) {
    if (content.includes("Recovery BACK blocked inside app")) {
        console.log("Looks like the patch was partially or fully applied already. Let's make sure it's clean.");
    } else {
        content = content.replace(hookSearch, recoveryCode);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log("Successfully fixed run.js with the intercept logic.");
    }
} else {
    console.log("Could not find the hook in run.js!");
}
