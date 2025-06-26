const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const userDataDir = path.dirname(app.getPath('userData'));

function createEnvDir() {
    if (!fs.existsSync(path.join(userDataDir, 'fluffbox/nodejs_versions'))) {
        fs.mkdirSync(path.join(userDataDir, 'fluffbox/nodejs_versions'), { recursive: true });
    }
    if (!fs.existsSync(path.join(userDataDir, 'fluffbox/python_versions'))) {
        fs.mkdirSync(path.join(userDataDir, 'fluffbox/python_versions'), { recursive: true });
    }
    if (!fs.existsSync(path.join(userDataDir, 'fluffbox/java_versions'))) {
        fs.mkdirSync(path.join(userDataDir, 'fluffbox/java_versions'), { recursive: true });
    }
}

function clearDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath);
  } else {
    fs.mkdirSync(dirPath);
  }
}

module.exports = {
    createEnvDir,
    clearDirectory
};
