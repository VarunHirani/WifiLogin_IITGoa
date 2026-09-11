const { chromium } = require("playwright");
const keytar = require("keytar");
const notifier = require("node-notifier");
const readline = require("readline");

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  // Windows captive portal connectivity test
  testUrl: "http://www.msftconnecttest.com/redirect",

  // IIT Goa captive portal
  portalHost: "firewall.iitgoa.ac.in",
  portalPort: "6082",
  portalPath: "/php/uid.php",

  // Windows Credential Manager entry
  credentialService: "IITGoa-WiFi-Login",

  usernameKey: "username",

  navigationTimeout: 15000,
  loginWait: 3000,

  maxRetries: 3,
  retryDelay: 1500,

  notifications: true
};


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function notify(title, message) {
  if (!CONFIG.notifications) return;

  notifier.notify({
    title,
    message,
    wait: false
  });
}


// ============================================================
// PALO ALTO PORTAL DETECTION
// ============================================================

function isPaloAltoPortal(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === CONFIG.portalHost &&
      parsed.port === CONFIG.portalPort &&
      parsed.pathname === CONFIG.portalPath
    );
  } catch {
    return false;
  }
}


// ============================================================
// CONNECTIVITY CHECK
// ============================================================

async function checkConnectivity(page) {
  try {
    await page.goto(CONFIG.testUrl, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.navigationTimeout
    });
  } catch (error) {
    // Captive portals can interrupt navigation with redirects.
    // We still inspect the final URL.
  }

  await sleep(1000);

  const currentUrl = page.url();

  return currentUrl;
}


// ============================================================
// CREDENTIAL MANAGEMENT
// ============================================================

async function getSavedCredentials() {
  const username = await keytar.getPassword(
    CONFIG.credentialService,
    CONFIG.usernameKey
  );

  // No username saved
  if (!username) {
    return null;
  }

  const password = await keytar.getPassword(
    CONFIG.credentialService,
    username
  );

  // Username exists but password doesn't
  if (!password) {
    return null;
  }

  return {
    username,
    password
  };
}

function askQuestion(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (!hidden) {
      rl.question(question, answer => {
        rl.close();
        resolve(answer.trim());
      });

      return;
    }

    // Windows CMD password input.
    // Characters are not echoed.
    process.stdout.write(question);

    let password = "";

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = char => {
      char = char.toString();

      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        rl.close();

        console.log();
        resolve(password);
        return;
      }

      if (char === "\u0003") {
        process.exit();
      }

      // Backspace
      if (char === "\b" || char === "\x7f") {
        password = password.slice(0, -1);
        return;
      }

      password += char;
    };

    process.stdin.on("data", onData);
  });
}


async function saveCredentials(username, password) {
  await keytar.setPassword(
    CONFIG.credentialService,
    CONFIG.usernameKey,
    username
  );

  await keytar.setPassword(
    CONFIG.credentialService,
    username,
    password
  );
}


async function getCredentials() {
  let credentials = await getSavedCredentials();

  if (credentials) {
    return credentials;
  }

  console.log("No saved IIT Goa WiFi credentials found.");
  console.log("Please enter them once.");
  console.log();

  const username = await askQuestion("Username: ");
  const password = await askQuestion("Password: ", true);

  await saveCredentials(username, password);

  console.log("Credentials saved securely in Windows Credential Manager.");
  console.log();

  return {
    username,
    password
  };
}


// ============================================================
// PALO ALTO LOGIN
// ============================================================

async function performPaloAltoLogin(page, credentials) {
  console.log("Palo Alto Authentication Portal detected.");

  // Wait for the login form to appear.
  await page.waitForSelector("#login_form", {
    timeout: CONFIG.navigationTimeout
  });

  console.log("Login form detected.");

  // Fill username.
  await page.locator("#user").fill(credentials.username);

  // Fill password.
  await page.locator("#passwd").fill(credentials.password);

  console.log("Submitting credentials...");

  // IMPORTANT:
  // We do NOT construct the POST URL ourselves.
  // The page already contains the correct dynamic action URL,
  // including token, vsys, rule, and redirect URL.
  await page.locator("#submit").click();

  await sleep(CONFIG.loginWait);

  console.log(`After login: ${page.url()}`);
}


// ============================================================
// VERIFY AUTHENTICATION
// ============================================================

async function verifyAuthentication(page) {
  console.log("Verifying Internet connectivity...");

  const finalUrl = await checkConnectivity(page);

  console.log(`Verification URL: ${finalUrl}`);

  if (isPaloAltoPortal(finalUrl)) {
    return false;
  }

  return true;
}


// ============================================================
// SINGLE LOGIN ATTEMPT
// ============================================================

async function loginAttempt(page, credentials) {
  console.log("Checking IIT Goa WiFi authentication...");

  const currentUrl = await checkConnectivity(page);

  console.log(`Current URL: ${currentUrl}`);

  // ----------------------------------------------------------
  // Already authenticated
  // ----------------------------------------------------------

  if (!isPaloAltoPortal(currentUrl)) {
    console.log("✓ Internet access is already available.");

    notify(
      "IIT Goa WiFi",
      "✓ Already connected."
    );

    return true;
  }

  // ----------------------------------------------------------
  // Captive portal detected
  // ----------------------------------------------------------

  console.log("Authentication required.");

  await performPaloAltoLogin(page, credentials);

  // ----------------------------------------------------------
  // Verify login
  // ----------------------------------------------------------

  const authenticated = await verifyAuthentication(page);

  if (authenticated) {
    console.log("✓ Successfully authenticated.");

    notify(
      "IIT Goa WiFi",
      "✓ Successfully authenticated."
    );

    return true;
  }

  console.log("✗ Authentication failed.");

  return false;
}


// ============================================================
// RESET SAVED CREDENTIALS
// ============================================================

async function resetCredentials() {
  const username = await keytar.getPassword(
    CONFIG.credentialService,
    CONFIG.usernameKey
  );

  if (!username) {
    console.log("No saved credentials found.");
    return;
  }

  await keytar.deletePassword(
    CONFIG.credentialService,
    CONFIG.usernameKey
  );

  await keytar.deletePassword(
    CONFIG.credentialService,
    username
  );

  console.log("Saved credentials removed.");
}


// ============================================================
// HELP
// ============================================================

function showHelp() {
  console.log(`
IIT Goa WiFi Auto Login
=======================

Usage:

  node app.js
      Check WiFi and automatically log in if necessary.

  node app.js --reset
      Remove saved WiFi credentials.

  node app.js --verbose
      Run with additional console output.

  node app.js --help
      Show this help message.
`);
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    showHelp();
    return;
  }

  if (args.includes("--reset")) {
    await resetCredentials();
    return;
  }

  const verbose = args.includes("--verbose");

  if (verbose) {
    console.log("Verbose mode enabled.");
    console.log();
  }

  // Get username/password from Windows Credential Manager.
  const credentials = await getCredentials();

  let browser;

  try {

    // --------------------------------------------------------
    // Launch Chromium
    // --------------------------------------------------------

    browser = await chromium.launch({
      headless: true
    });

    // --------------------------------------------------------
    // Create browser context
    // --------------------------------------------------------

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    // --------------------------------------------------------
    // Create page
    // --------------------------------------------------------

    const page = await context.newPage();

    // --------------------------------------------------------
    // Attempt login
    // --------------------------------------------------------

    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {

      console.log(
        `Attempt ${attempt}/${CONFIG.maxRetries}`
      );

      try {

        const success = await loginAttempt(
          page,
          credentials
        );

        if (success) {
          return;
        }

      } catch (error) {

        console.error(
          `Attempt ${attempt} failed:`,
          error.message
        );
      }

      if (attempt < CONFIG.maxRetries) {
        console.log(
          `Retrying in ${CONFIG.retryDelay} ms...`
        );

        await sleep(CONFIG.retryDelay);
      }
    }

    // --------------------------------------------------------
    // All attempts failed
    // --------------------------------------------------------

    console.log(
      "✗ Could not authenticate to IIT Goa WiFi."
    );

    notify(
      "IIT Goa WiFi",
      "✗ Authentication failed."
    );

  } finally {

    // --------------------------------------------------------
    // Always close browser
    // --------------------------------------------------------

    if (browser) {
      await browser.close();
    }
  }
}


// ============================================================
// PROGRAM ENTRY POINT
// ============================================================

main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });