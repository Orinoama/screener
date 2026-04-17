const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let win;
let server;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function getServerCwd() {
  return path.join(__dirname, ".next", "standalone");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Screener",
    backgroundColor: "#0b0e11",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL("http://localhost:3000");
  win.once("ready-to-show", () => {
    win.show();
  });
  win.on("closed", () => {
    win = null;
  });
}

function startServer() {
  const cwd = getServerCwd();
  server = spawn(process.execPath, [path.join(cwd, "server.js")], {
    env: { ...process.env, PORT: "3000", HOSTNAME: "localhost" },
    stdio: "pipe",
    cwd,
  });
}

app.whenReady().then(() => {
  startServer();
  let retries = 0;
  const tryLoad = () => {
    setTimeout(() => {
      if (retries < 15) {
        createWindow();
        retries++;
      }
    }, 2000);
  };
  tryLoad();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (server) server.kill();
});
