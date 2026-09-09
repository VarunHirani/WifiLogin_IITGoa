const { spawn } = require("child_process");
const path = require("path");

const appPath = path.join(__dirname, "app.js");

const child = spawn(
    process.execPath,
    [appPath],
    {
        windowsHide: true,
        stdio: "ignore"
    }
);

child.on("error", error => {
    console.error("Failed to start IIT Goa WiFi:", error);
});