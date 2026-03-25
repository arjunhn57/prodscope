const fs = require('fs');

const filePath = 'c:\\Users\\Arjun\\Desktop\\prodscope\\vm-files\\prodscope-backend-live\\crawler\\run.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove duplicate utility overlay block
// Find the index of the second occurrence of "if (isUtilityOverlayScreen(snapshot.xml))"
const overlaySearch = "if (isUtilityOverlayScreen(snapshot.xml)) {";
const firstIndex = content.indexOf(overlaySearch);
if (firstIndex !== -1) {
  const secondIndex = content.indexOf(overlaySearch, firstIndex + 1);
  if (secondIndex !== -1) {
    // Find the end of this block. It's roughly 42 lines long, ends with "continue;\n    }"
    // A safer way is regex to match the block:
    const blockRegex = /if \(isUtilityOverlayScreen\(snapshot\.xml\)\) \{\s*console\.log\('  \[crawler\] Utility overlay detected - trying in-app escape first'\);\s*const overlayCandidates = actions\.extract\(snapshot\.xml\);\s*const closeLike = overlayCandidates\.find\(\(a\) => \{\s*const combined = `\$\{a\.text \|\| ''\} \$\{a\.contentDesc \|\| ''\} \$\{a\.resourceId \|\| ''\}`\.toLowerCase\(\);\s*return \(\s*a\.type === actions\.ACTION_TYPES\.TAP &&\s*\(\s*combined\.includes\('close'\) \|\|\s*combined\.includes\('back'\) \|\|\s*combined\.includes\('cancel'\) \|\|\s*combined\.includes\('done'\)\s*\)\s*\);\s*\}\);\s*if \(closeLike\) \{\s*const description = executeAction\(closeLike\);\s*actionsTaken\.push\(\{\s*step,\s*type: closeLike\.type,\s*description,\s*reason: 'utility_overlay_close_action',\s*actionKey: closeLike\.key \|\| description,\s*fromFingerprint: fp,\s*\}\);\s*\} else \{\s*adb\.pressBack\(\);\s*actionsTaken\.push\(\{\s*step,\s*type: 'back',\s*description: 'press_back',\s*reason: 'utility_overlay_escape',\s*actionKey: 'back',\s*fromFingerprint: fp,\s*\}\);\s*\}\s*await sleep\(2000\);\s*continue;\s*\}/g;

    let matchCount = 0;
    content = content.replace(blockRegex, (match) => {
        matchCount++;
        if (matchCount === 2) {
            console.log("Removed duplicate overlay block.");
            return '';
        }
        return match;
    });
  }
}

// 2. Insert recovery relaunch logic
const hookSearch = "const description = executeAction(decision.action);";

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

content = content.replace(hookSearch, recoveryCode);
console.log("Inserted BACK recovery logic.");

fs.writeFileSync(filePath, content, 'utf8');
console.log("Patch complete.");
