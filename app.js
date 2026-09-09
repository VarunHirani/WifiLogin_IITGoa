const { chromium } = require("playwright");
const keytar = require("keytar");
const notifier = require("node-notifier");
const readline = require("readline");

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // HTTP URL intentionally used to trigger FortiGate
    // captive portal interception.
    testUrl: "http://example.com/",

    // IIT Goa FortiGate hostname.
    fortigateHost: "firewall.iitgoa.ac.in",

    // Windows Credential Manager identifiers.
    credentialService: "IITGoa-WiFi-Login",
    usernameKey: "username",

    // Network/browser timeouts.
    navigationTimeout: 15000,
    portalWait: 2500,
    loginWait: 3000,

    // Retry settings.
    maxRetries: 3,
    retryDelay: 1500,

    // Enable/disable Windows notifications.
    notifications: true
};


// ============================================================
// COMMAND LINE OPTIONS
// ============================================================

const args = process.argv.slice(2);

const RESET_CREDENTIALS =
    args.includes("--reset");

const VERBOSE =
    args.includes("--verbose");

const HELP =
    args.includes("--help") ||
    args.includes("-h");


// ============================================================
// LOGGING
// ============================================================

function log(message = "") {
    console.log(message);
}


function debug(message = "") {

    if (VERBOSE) {
        console.log(`[DEBUG] ${message}`);
    }
}


// ============================================================
// WINDOWS NOTIFICATIONS
// ============================================================

function notify(title, message) {

    if (!CONFIG.notifications) {
        return;
    }

    try {

        notifier.notify({
            title,
            message,
            wait: false
        });

    } catch (error) {

        debug(
            `Notification error: ${error.message}`
        );
    }
}


// ============================================================
// HELP
// ============================================================

function showHelp() {

    console.log(`
IIT Goa WiFi Login

Usage:

    node app.js
        Check IIT Goa WiFi and automatically authenticate
        if authentication is required.

    node app.js --reset
        Delete saved IIT Goa WiFi credentials.

    node app.js --verbose
        Show detailed debugging information.

    node app.js --help
        Show this help message.
`);
}


// ============================================================
// CONSOLE INPUT
// ============================================================

function ask(question) {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {

        rl.question(question, answer => {

            rl.close();

            resolve(answer.trim());
        });
    });
}


function askPassword(question) {

    return new Promise(resolve => {

        process.stdout.write(question);

        const stdin = process.stdin;

        stdin.setRawMode(true);
        stdin.resume();

        let password = "";

        function onData(data) {

            const char = data.toString();

            // ENTER
            if (
                char === "\r" ||
                char === "\n"
            ) {

                stdin.setRawMode(false);
                stdin.pause();

                stdin.removeListener(
                    "data",
                    onData
                );

                process.stdout.write("\n");

                resolve(password);

                return;
            }

            // CTRL+C
            if (char === "\u0003") {

                stdin.setRawMode(false);
                stdin.pause();

                stdin.removeListener(
                    "data",
                    onData
                );

                process.exit(1);
            }

            // BACKSPACE
            if (char === "\u007f") {

                password =
                    password.slice(0, -1);

                return;
            }

            password += char;
        }

        stdin.on("data", onData);
    });
}


// ============================================================
// WINDOWS CREDENTIAL MANAGER
// ============================================================

async function getStoredCredentials() {

    debug(
        "Checking Windows Credential Manager..."
    );

    const username =
        await keytar.getPassword(
            CONFIG.credentialService,
            CONFIG.usernameKey
        );

    if (!username) {

        debug(
            "No saved username found."
        );

        return null;
    }


    const password =
        await keytar.getPassword(
            CONFIG.credentialService,
            username
        );

    if (!password) {

        debug(
            "Username found but password is missing."
        );

        return null;
    }


    debug(
        "Saved credentials found."
    );

    return {
        username,
        password
    };
}


async function saveCredentials(
    username,
    password
) {

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


async function deleteCredentials() {

    log(
        "Removing saved IIT Goa WiFi credentials..."
    );

    const username =
        await keytar.getPassword(
            CONFIG.credentialService,
            CONFIG.usernameKey
        );


    if (username) {

        await keytar.deletePassword(
            CONFIG.credentialService,
            username
        );
    }


    await keytar.deletePassword(
        CONFIG.credentialService,
        CONFIG.usernameKey
    );


    log("✓ Saved credentials removed.");
}


async function getCredentials() {

    /*
     * First attempt to retrieve saved credentials.
     */
    const stored =
        await getStoredCredentials();


    if (stored) {

        log(
            "Using saved IIT Goa credentials."
        );

        return stored;
    }


    /*
     * First-time setup.
     */
    log("");
    log("---------------------------------");
    log("IIT Goa WiFi first-time setup");
    log("---------------------------------");
    log("");


    const username =
        await ask("Username: ");


    if (!username) {

        throw new Error(
            "Username cannot be empty."
        );
    }


    const password =
        await askPassword("Password: ");


    if (!password) {

        throw new Error(
            "Password cannot be empty."
        );
    }


    await saveCredentials(
        username,
        password
    );


    log("");
    log(
        "✓ Credentials saved securely."
    );
    log("");


    return {
        username,
        password
    };
}


// ============================================================
// FORTIGATE DETECTION
// ============================================================

function isFortiGatePage(url) {

    if (!url) {
        return false;
    }


    return (
        url.includes(
            CONFIG.fortigateHost
        ) &&
        (
            url.includes("/fgtauth") ||
            url.includes("/login")
        )
    );
}


// ============================================================
// CONNECTIVITY TEST
// ============================================================

async function checkConnectivity(page) {

    for (
        let attempt = 1;
        attempt <= CONFIG.maxRetries;
        attempt++
    ) {

        debug(
            `Connectivity attempt ${attempt}/${CONFIG.maxRetries}`
        );


        try {

            await page.goto(
                CONFIG.testUrl,
                {
                    waitUntil: "commit",
                    timeout:
                        CONFIG.navigationTimeout
                }
            );


            /*
             * Give FortiGate time to perform
             * captive portal interception.
             */
            await page.waitForTimeout(
                CONFIG.portalWait
            );


            const url =
                page.url();


            debug(
                `Resulting URL: ${url}`
            );


            return {
                success: true,
                url
            };


        } catch (error) {

            debug(
                `Attempt ${attempt} failed: ${error.message}`
            );


            if (
                attempt <
                CONFIG.maxRetries
            ) {

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            CONFIG.retryDelay
                        )
                );
            }
        }
    }


    return {
        success: false,
        url: null
    };
}


// ============================================================
// FIND FORTIGATE LOGIN FORM
// ============================================================

async function findLoginForm(page) {

    const usernameField =
        page.locator("#ft_un");

    const passwordField =
        page.locator("#ft_pd");


    if (
        await usernameField.count() === 0
    ) {

        return null;
    }


    if (
        await passwordField.count() === 0
    ) {

        return null;
    }


    return {
        usernameField,
        passwordField
    };
}


// ============================================================
// FORTIGATE LOGIN
// ============================================================

async function performLogin(page) {

    log(
        "Authentication required."
    );


    debug(
        "FortiGate login page detected."
    );


    // --------------------------------------------------------
    // Locate login form
    // --------------------------------------------------------

    const form =
        await findLoginForm(page);


    if (!form) {

        throw new Error(
            "FortiGate login form was not found."
        );
    }


    // --------------------------------------------------------
    // Find dynamic magic value
    // --------------------------------------------------------

    const magicField =
        page.locator(
            'input[name="magic"]'
        );


    if (
        await magicField.count() === 0
    ) {

        throw new Error(
            "FortiGate magic field was not found."
        );
    }


    const magic =
        await magicField.inputValue();


    /*
     * We deliberately don't print the actual magic value.
     */
    debug(
        `Dynamic authentication token detected (${magic.length} characters).`
    );


    // --------------------------------------------------------
    // Get redirect destination
    // --------------------------------------------------------

    const redirectField =
        page.locator(
            'input[name="4Tredir"]'
        );


    if (
        await redirectField.count() > 0
    ) {

        const redirectURL =
            await redirectField.inputValue();


        debug(
            `Redirect destination: ${redirectURL}`
        );
    }


    // --------------------------------------------------------
    // Get credentials
    // --------------------------------------------------------

    const credentials =
        await getCredentials();


    // --------------------------------------------------------
    // Fill username
    // --------------------------------------------------------

    await form.usernameField.fill(
        credentials.username
    );


    // --------------------------------------------------------
    // Fill password
    // --------------------------------------------------------

    await form.passwordField.fill(
        credentials.password
    );


    // --------------------------------------------------------
    // Locate Login button
    // --------------------------------------------------------

    const loginButton =
        page.locator(
            'input[type="submit"]'
        );


    if (
        await loginButton.count() === 0
    ) {

        throw new Error(
            "FortiGate Login button was not found."
        );
    }


    // --------------------------------------------------------
    // Submit
    // --------------------------------------------------------

    log(
        "Submitting credentials..."
    );


    await loginButton
        .first()
        .click();


    /*
     * Give FortiGate time to process
     * the authentication.
     */
    await page.waitForTimeout(
        CONFIG.loginWait
    );


    debug(
        `Post-login URL: ${page.url()}`
    );
}


// ============================================================
// VERIFY AUTHENTICATION
// ============================================================

async function verifyAuthentication(page) {

    log(
        "Verifying Internet access..."
    );


    try {

        await page.goto(
            CONFIG.testUrl,
            {
                waitUntil:
                    "domcontentloaded",

                timeout:
                    CONFIG.navigationTimeout
            }
        );


        await page.waitForTimeout(
            1000
        );


        const url =
            page.url();


        debug(
            `Verification URL: ${url}`
        );


        /*
         * If we're redirected back to FortiGate,
         * authentication failed.
         */
        if (
            isFortiGatePage(url)
        ) {

            return false;
        }


        return true;


    } catch (error) {

        debug(
            `Verification error: ${error.message}`
        );

        return false;
    }
}


// ============================================================
// MAIN
// ============================================================

async function main() {

    let browser = null;


    try {

        // ----------------------------------------------------
        // Command line options
        // ----------------------------------------------------

        if (HELP) {

            showHelp();

            return;
        }


        if (RESET_CREDENTIALS) {

            await deleteCredentials();

            return;
        }


        // ----------------------------------------------------
        // Start
        // ----------------------------------------------------

        log("");
        log("=================================");
        log("       IIT GOA WIFI LOGIN");
        log("=================================");
        log("");


        // ----------------------------------------------------
        // Launch Chromium
        // ----------------------------------------------------

        debug(
            "Launching Chromium..."
        );


        browser =
            await chromium.launch({
                headless: true
            });


        const context =
            await browser.newContext({

                /*
                 * Required because FortiGate's
                 * captive portal may use a
                 * certificate that doesn't match
                 * the intercepted hostname.
                 */
                ignoreHTTPSErrors: true
            });


        const page =
            await context.newPage();


        // ----------------------------------------------------
        // Check authentication
        // ----------------------------------------------------

        const connectivity =
            await checkConnectivity(page);


        if (
            !connectivity.success
        ) {

            throw new Error(
                "Could not reach the network. Make sure you are connected to IIT Goa WiFi."
            );
        }


        const currentURL =
            connectivity.url;


        debug(
            `Current URL: ${currentURL}`
        );


        // ----------------------------------------------------
        // Already authenticated
        // ----------------------------------------------------

        if (
            !isFortiGatePage(
                currentURL
            )
        ) {

            log(
                "✓ Already authenticated."
            );


            notify(
                "IIT Goa WiFi",
                "✓ Already connected."
            );


            return;
        }


        // ----------------------------------------------------
        // Login
        // ----------------------------------------------------

        await performLogin(page);


        // ----------------------------------------------------
        // Verify
        // ----------------------------------------------------

        const authenticated =
            await verifyAuthentication(
                page
            );


        if (authenticated) {

            log("");
            log(
                "================================="
            );
            log(
                "✓ IIT GOA WIFI LOGIN SUCCESSFUL"
            );
            log(
                "================================="
            );
            log("");


            notify(
                "IIT Goa WiFi",
                "✓ Successfully authenticated."
            );


        } else {

            log("");
            log(
                "================================="
            );
            log(
                "✗ IIT GOA WIFI LOGIN FAILED"
            );
            log(
                "================================="
            );
            log("");


            notify(
                "IIT Goa WiFi",
                "✗ Authentication failed."
            );


            log(
                "If your password has changed, reset your saved credentials with:"
            );

            log("");
            log(
                "    node app.js --reset"
            );

            log("");


            process.exitCode = 1;
        }


    } catch (error) {

        log("");
        log(
            "================================="
        );
        log(
            "✗ IIT GOA WIFI LOGIN ERROR"
        );
        log(
            "================================="
        );
        log("");


        log(
            error.message
        );


        notify(
            "IIT Goa WiFi",
            "✗ Could not connect or authenticate."
        );


        log("");


        process.exitCode = 1;


    } finally {

        if (browser) {

            await browser.close();
        }
    }
}


// ============================================================
// START
// ============================================================

main()
    .then(() => {
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });