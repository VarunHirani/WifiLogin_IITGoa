# IIT Goa WiFi Auto Login

A lightweight Windows utility that automatically detects and authenticates to the **IIT Goa WiFi captive portal**.

The utility checks whether the device is already authenticated. If authentication is required, it automatically opens the FortiGate captive portal in a hidden Chromium browser, retrieves the dynamically generated session parameters, submits the saved credentials, and verifies Internet access.

---

## Features

- Automatically detects whether IIT Goa WiFi authentication is required
- Automatically logs in to the IIT Goa FortiGate captive portal
- Uses the dynamically generated FortiGate `magic` session token
- Stores credentials securely using Windows Credential Manager through `keytar`
- Runs Chromium in headless mode — no browser window is displayed during authentication
- Verifies Internet connectivity after login
- Retries authentication if a temporary connection failure occurs
- Provides Windows desktop notifications
- Supports resetting saved credentials
- Supports verbose/debug output
- Can be launched by double-clicking `start.bat`

---

## How It Works

The IIT Goa WiFi network uses a **captive portal**. When a device connects to the WiFi network but has not yet authenticated, normal Internet requests are intercepted by the FortiGate firewall and redirected to the IIT Goa login page. The utility takes advantage of this behavior.

### Authentication Flow

```text
                 Connect to IIT Goa WiFi
                           |
                           v
                Check Internet access
                           |
                           v
                Open test URL
                           |
                 +---------+---------+
                 |                   |
                 v                   v
          Already authenticated   Not authenticated
                 |                   |
                 v                   v
              Exit          FortiGate captive portal
                                      |
                                      v
                          Extract dynamic session data
                                      |
                                      v
                           Enter username/password
                                      |
                                      v
                              Submit login form
                                      |
                                      v
                            Verify Internet access
                                      |
                           +----------+----------+
                           |                     |
                           v                     v
                       Successful              Failed
                           |                     |
                           v                     v
                         Exit             Retry / Report error
```

### Captive Portal Detection

The utility does not directly assume that the user is logged out. Instead, it navigates to a normal HTTP test URL:

```
http://example.com/
```

**When already authenticated** — the request reaches the Internet normally, so the utility determines that authentication is not required.

**When authentication is required** — the IIT Goa FortiGate firewall intercepts the request and redirects the browser to a URL similar to:

```
https://firewall.iitgoa.ac.in:1003/fgtauth?<dynamic_token>
```

The important point is that this token is dynamic — it changes between authentication sessions, so the application does not hard-code it.

### FortiGate Login

The captive portal login page contains a form with fields including `username`, `password`, `magic`, and `4Tredir`. The utility retrieves these values directly from the loaded login page. The application then:

1. Detects the FortiGate authentication page
2. Reads the dynamically generated `magic` value
3. Reads the redirect destination (`4Tredir`)
4. Retrieves the saved IIT Goa username and password
5. Fills the login form
6. Submits the form
7. Waits for the authentication process to complete
8. Tests Internet connectivity again

The application therefore does not rely on a hard-coded `magic` token.

---

## Project Structure

```
iitgoa-wifi-login/
│
├── app.js
├── package.json
├── package-lock.json
├── start.bat
├── .gitignore
└── node_modules/
```

**`app.js`** — the main application. Responsible for launching Playwright, checking Internet connectivity, detecting the FortiGate captive portal, extracting the dynamic session token, retrieving saved credentials, performing authentication, verifying the login, handling retries, displaying notifications, and handling command-line options.

**`start.bat`** — a simple Windows launcher:

```bat
@echo off
cd /d "%~dp0"
node app.js
```

The `%~dp0` part makes the script change to the directory containing `start.bat`, so the application can correctly locate `app.js` regardless of where the shortcut is launched from.

**`package.json`** — project metadata, scripts, and dependencies.

**`package-lock.json`** — locks the dependency versions used by the project.

**`.gitignore`** — prevents unnecessary or sensitive files from being committed to Git, for example:

```
node_modules/
.env
*.log
```

---

## Technologies Used

### Node.js
The main runtime used to execute the application. Node.js allows the utility to interact with the operating system, installed packages, Windows Credential Manager, Playwright, and desktop notifications.

### Playwright
Playwright is used to automate Chromium — opening a browser, navigating to the test URL, following the FortiGate redirect, detecting the login page, filling the authentication form, submitting the credentials, and verifying Internet access. The browser runs in headless mode, so the user does not see a browser window.

### Chromium
Playwright uses Chromium to reproduce normal browser behavior. This is important because the FortiGate captive portal performs its redirection at the browser/network level, so the application uses a real browser rather than relying only on Node.js HTTP requests.

### keytar
`keytar` is used to securely store and retrieve the IIT Goa WiFi credentials. The password is not stored directly inside `app.js`; instead, credentials are stored using the operating system's credential storage mechanism — on Windows, this uses Windows Credential Manager, under a service identifier similar to `IITGoa-WiFi-Login`. The password is never intentionally written to source code, logs, GitHub, or configuration files.

### node-notifier
`node-notifier` is used to display Windows desktop notifications, for example:

```
IIT Goa WiFi
✓ Already connected.
```

```
IIT Goa WiFi
✓ Successfully authenticated.
```

---

## Requirements

- Windows 10 or later
- Node.js
- npm
- IIT Goa WiFi access
- A valid IIT Goa WiFi account

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<YOUR_USERNAME>/iitgoa-wifi-login.git
cd iitgoa-wifi-login
```

### 2. Install dependencies

```bash
npm install
```

This installs Playwright, keytar, and node-notifier.

### 3. Install Playwright Chromium

```bash
npx playwright install chromium
```

---

## First-Time Setup

Run:

```bash
node app.js
```

If no credentials are stored, the application will request the IIT Goa WiFi credentials. Enter the credentials locally — the password is then stored using Windows Credential Manager. Credentials do not need to be entered every time the program runs.

---

## Running the Application

### Normal execution

```bash
node app.js
```

### Using the batch launcher

Double-click `start.bat`. This is the recommended method for normal use during the current development version. A desktop shortcut can also be created for `start.bat`.

---

## Command-Line Options

### Normal mode

```bash
node app.js
```

Runs the WiFi authentication process normally.

### Verbose/debug mode

```bash
node app.js --verbose
```

Displays additional information about the authentication process, for example:

```
[DEBUG] Launching Chromium...
[DEBUG] Connectivity attempt 1/3
[DEBUG] Resulting URL: http://example.com/
[DEBUG] Current URL: http://example.com/
```

### Reset saved credentials

```bash
node app.js --reset
```

Removes the saved IIT Goa WiFi credentials from Windows Credential Manager. The next time the application is executed, it will request the credentials again.

### Help

```bash
node app.js --help
```

Displays the available command-line options.

---

## Security

Security is an important part of this project because the application handles WiFi credentials.

- **Credentials are not hard-coded.** The application does not store credentials directly inside the source code (e.g. `const password = "..."`); it uses `keytar` instead.
- **Credentials are stored locally**, using the Windows credential storage system rather than being uploaded to a remote server by this application.
- **Credentials are not committed to GitHub.** The repository should never contain passwords, API keys, authentication tokens, or `.env` files containing credentials. The `.gitignore` file helps prevent accidental commits of sensitive configuration files.
- **Dynamic FortiGate tokens.** The FortiGate `magic` value is dynamically generated by the captive portal and obtained from the current authentication page rather than hard-coded, since it can change between sessions.

---

## Why a Real Browser Is Used

An initial approach using direct HTTP requests is not sufficient for reliable captive-portal detection, because the FortiGate firewall intercepts normal browser navigation when authentication is required:

```
Browser
   |
   | GET http://example.com/
   |
   v
IIT Goa FortiGate
   |
   | Authentication required
   |
   v
https://firewall.iitgoa.ac.in:1003/fgtauth?...
```

A Playwright-controlled browser reproduces this behavior more reliably:

```
Node.js → Playwright → Chromium → IIT Goa WiFi captive portal
```

---

## Error Handling

The application includes retry logic for temporary failures:

```
Attempt authentication
       |
       v
Verify Internet
       |
       +---- Success ---> Exit
       |
       +---- Failure
                |
                v
             Retry
                |
                v
          Maximum retries
                |
                v
             Report error
```

This helps handle temporary network instability.

---

## Current Limitations

The current version is designed specifically around the IIT Goa WiFi captive portal, so:

- It is not a generic WiFi login utility
- The FortiGate portal structure may change in the future
- The application currently requires Node.js to be installed
- Chromium is managed through Playwright
- The current version is launched manually through `start.bat`
- It does not yet automatically detect every WiFi reconnection event
- It does not currently run automatically at Windows startup

---

## Future Improvements

- **Windows executable** — package the application as `IITGoaWiFi.exe` so Node.js does not need to be manually invoked
- **Windows startup** — allow the utility to run automatically when Windows starts and check/perform authentication as needed
- **Automatic reconnection** — monitor the connection and automatically re-authenticate when the captive portal session expires
- **System tray application** — add a Windows system tray interface (Connected status, Check Now, Reset Credentials, Settings, Exit)
- **Better notifications** — clearer notifications for authentication required/successful/failed, Internet unavailable, and WiFi disconnected
- **Configuration support** — configurable connectivity test URL, retry count, timeout values, and notification preferences

---

## Development

```bash
npm install
npx playwright install chromium

npm start       # run normally
npm run debug   # run in verbose/debug mode
npm run reset   # reset saved credentials
```

---

## Troubleshooting

**Application says Internet is unavailable**
Make sure the computer is actually connected to the IIT Goa WiFi network.

**Login page does not appear**
The FortiGate captive portal behavior may have changed. Try opening `http://example.com/` in a normal browser while disconnected from authentication — if the browser is not redirected to the IIT Goa login portal, the captive portal may currently be unavailable or its behavior may have changed.

**Credentials are rejected**
Reset the stored credentials, then re-enter them:

```bash
node app.js --reset
node app.js
```

**Need more information**
Run in verbose mode to help identify where the authentication process is failing:

```bash
node app.js --verbose
```

---

## Project Status

**Current status:** Working prototype / Windows utility

The following functionality has been tested:

- [x] Captive portal detection
- [x] FortiGate login page detection
- [x] Dynamic session token extraction
- [x] Username/password submission
- [x] Successful authentication
- [x] Already-authenticated detection
- [x] Internet verification
- [x] Credential persistence
- [x] Credential reset
- [x] Retry handling
- [x] Headless browser operation
- [x] Windows notifications
- [x] Batch-file launcher

Future development will focus on packaging and improving the Windows user experience.

---

## Disclaimer

This project is intended for use with the IIT Goa WiFi network by authorized users. It automates the normal authentication process available through the IIT Goa captive portal. Users should comply with IIT Goa's network usage policies and terms of service. The project does not attempt to bypass authentication or gain unauthorized access to the network.

---

## License

This project is licensed under the [MIT License](LICENSE).
