"use strict";

const { execSync, exec } = require("child_process");
const { sleep } = require("../utils/sleep");
const {
  EMULATOR_AVD,
  SNAPSHOT_NAME,
  SNAPSHOT_BOOT_TIMEOUT,
  COLD_BOOT_TIMEOUT,
} = require("../config/defaults");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEmulatorOnline() {
  try {
    const devices = execSync("adb devices", { timeout: 5000 }).toString();
    return devices.includes("emulator-") && !devices.includes("offline");
  } catch (e) {
    return false;
  }
}

function isBootCompleted() {
  try {
    return (
      execSync("adb shell getprop sys.boot_completed", { timeout: 5000 })
        .toString()
        .trim() === "1"
    );
  } catch (e) {
    return false;
  }
}

async function waitForBoot(timeoutSeconds) {
  const polls = timeoutSeconds; // 1 poll per second
  for (let i = 0; i < polls; i++) {
    if (isEmulatorOnline() && isBootCompleted()) return true;
    await sleep(1000);
  }
  return false;
}

function snapshotExists() {
  try {
    const list = execSync(
      `emulator -avd ${EMULATOR_AVD} -snapshot-list -no-window 2>&1`,
      { timeout: 10000 }
    ).toString();
    return list.includes(SNAPSHOT_NAME);
  } catch (e) {
    return false;
  }
}

function cleanupProcesses() {
  try { execSync("adb kill-server", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -f emulator", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -f qemu-system-x86_64", { stdio: "ignore" }); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Boot the emulator. Tries snapshot restore first (<15s), falls back to cold
 * boot (~2-4 min) if no snapshot is available.
 */
async function bootEmulator() {
  execSync("sudo chmod 666 /dev/kvm", { stdio: "ignore" });
  cleanupProcesses();
  await sleep(2000);

  const hasSnapshot = snapshotExists();
  const mode = hasSnapshot ? "snapshot" : "cold";
  console.log(`Emulator boot: mode=${mode}, avd=${EMULATOR_AVD}`);

  if (hasSnapshot) {
    // Snapshot restore — fast path
    exec(
      `nohup emulator -avd ${EMULATOR_AVD} -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -snapshot ${SNAPSHOT_NAME} > /tmp/prodscope-emulator.log 2>&1 &`,
    );

    await sleep(3000);
    try { execSync("adb start-server", { stdio: "ignore" }); } catch (e) {}

    const booted = await waitForBoot(SNAPSHOT_BOOT_TIMEOUT);
    if (booted) {
      console.log("Emulator restored from snapshot in <" + SNAPSHOT_BOOT_TIMEOUT + "s");
      return;
    }

    // Snapshot restore failed — kill and fall through to cold boot
    console.log("Snapshot restore failed, falling back to cold boot");
    cleanupProcesses();
    await sleep(2000);
  }

  // Cold boot — original path
  exec(
    `nohup emulator -avd ${EMULATOR_AVD} -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot > /tmp/prodscope-emulator.log 2>&1 &`,
  );

  await sleep(8000);
  try { execSync("adb start-server", { stdio: "ignore" }); } catch (e) {}

  const booted = await waitForBoot(COLD_BOOT_TIMEOUT);
  if (!booted) {
    let emuLog = "";
    try {
      emuLog = execSync("tail -n 80 /tmp/prodscope-emulator.log").toString();
    } catch (e) {}
    throw new Error("Emulator failed to boot. " + emuLog);
  }

  await sleep(5000);
  console.log("Emulator cold-booted successfully");
}

/**
 * Save a snapshot of the current emulator state.
 * Run this once manually after the emulator is booted and idle:
 *   node -e "require('./emulator/manager').saveSnapshot()"
 */
async function saveSnapshot() {
  console.log(`Saving snapshot '${SNAPSHOT_NAME}'...`);
  execSync(`adb emu avd snapshot save ${SNAPSHOT_NAME}`, { timeout: 30000 });
  console.log("Snapshot saved.");
}

/**
 * Install an APK onto the running emulator.
 */
function installApk(apkPath) {
  execSync('adb install -r "' + apkPath + '"', { timeout: 60000 });
}

/**
 * Kill the running emulator. Swallows errors (best-effort cleanup).
 */
function killEmulator() {
  try {
    execSync("adb emu kill", { stdio: "ignore" });
  } catch (e) {}
}

module.exports = { bootEmulator, saveSnapshot, installApk, killEmulator };
