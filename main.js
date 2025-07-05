const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configManager = require('./utils/configManager');
const { registerNodeHandlers } = require('./utils/nodeManager');
const { registerPythonHandlers } = require('./utils/pythonManager');
const { registerJavaHandlers } = require('./utils/javaManager');
const { createEnvDir, clearDirectory } = require('./utils/dir');
const { addUserPath } = require('./utils/path');

const metaData = yaml.load(fs.readFileSync(path.join(__dirname, 'config/meta.yml'), 'utf8'));
const license = fs.readFileSync(path.join(__dirname, 'config/LICENSE.txt'), 'utf8');

configManager.loadConfig();
const lang = configManager.get('language') || 'ja';

const userDataDir = path.dirname(app.getPath('userData'));

let mainWindow;
let configWindow;

createEnvDir();
addUserPath(path.join(userDataDir, 'fluffbox/nodejs_versions/current'));
addUserPath(path.join(userDataDir, 'fluffbox/python_versions/current'));
addUserPath(path.join(userDataDir, 'fluffbox/java_versions/current/bin'));

function loadMenu() {
  const menu = JSON.parse(fs.readFileSync(path.join(__dirname, `config/menu_${lang}.json`)));

  const assignClicks = (items) => {
    for (const item of items) {
      if (item.submenu) {
        assignClicks(item.submenu);
      } else {
        switch (item.id) {
          case "openFolderNodejs":
            item.click = () => {
              shell.openPath(path.join(userDataDir, 'fluffbox/nodejs_versions'))
                .then(result => {
                  if (result) {
                    dialog.showMessageBox({
                      type: 'error',
                      title: ' (´× ω ×｀；)ｴﾗｰﾀﾞﾖ...',
                      message: `フォルダを開く際にエラーが発生しました: ${result}`,
                    });
                  }
                })
            }
            break;
          case "openFolderPython":
            item.click = () => {
              shell.openPath(path.join(userDataDir, 'fluffbox/python_versions'))
                .then(result => {
                  if (result) {
                    dialog.showMessageBox({
                      type: 'error',
                      title: ' (´× ω ×｀；)ｴﾗｰﾀﾞﾖ...',
                      message: `フォルダを開く際にエラーが発生しました: ${result}`,
                    });
                  }
                })
            }
            break;
          case "openFolderJava":
            item.click = () => {
              shell.openPath(path.join(userDataDir, 'fluffbox/java_versions'))
                .then(result => {
                  if (result) {
                    dialog.showMessageBox({
                      type: 'error',
                      title: ' (´× ω ×｀；)ｴﾗｰﾀﾞﾖ...',
                      message: `フォルダを開く際にエラーが発生しました: ${result}`,
                    });
                  }
                })
            }
            break;
          case "removeAll":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: '確認',
                message: 'すべての実行環境を削除しますか？',
                detail: 'この操作は元に戻せません。すべての実行環境が削除されます。',
                buttons: ['はい', 'いいえ'],
                defaultId: 1,
                cancelId: 1,
              }).then(result => {
                if (result.response === 0) {
                  clearDirectory(path.join(userDataDir, 'fluffbox/nodejs_versions'));
                  clearDirectory(path.join(userDataDir, 'fluffbox/python_versions'));
                  clearDirectory(path.join(userDataDir, 'fluffbox/java_versions'));
                  dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '完了',
                    message: 'すべての実行環境が削除されました。',
                  });
                }
              });
            }
            break;
          case "removeNodejs":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: '確認',
                message: 'Node.jsのすべてのバージョンを削除しますか？',
                detail: 'この操作は元に戻せません。すべてのNode.jsのバージョンが削除されます。',
                buttons: ['はい', 'いいえ'],
                defaultId: 1,
                cancelId: 1,
              }).then(result => {
                if (result.response === 0) {
                  clearDirectory(path.join(userDataDir, 'fluffbox/nodejs_versions'));
                  dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '完了',
                    message: 'Node.jsのすべてのバージョンが削除されました。',
                  });
                }
              });
            }
            break;
          case "removePython":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: '確認',
                message: 'Pythonのすべてのバージョンを削除しますか？',
                detail: 'この操作は元に戻せません。すべてのPythonのバージョンが削除されます。',
                buttons: ['はい', 'いいえ'],
                defaultId: 1,
                cancelId: 1,
              }).then(result => {
                if (result.response === 0) {
                  clearDirectory(path.join(userDataDir, 'fluffbox/python_versions'));
                  dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '完了',
                    message: 'Pythonのすべてのバージョンが削除されました。',
                  });
                }
              });
            }
            break;
          case "removeJava":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: '確認',
                message: 'Javaのすべてのバージョンを削除しますか？',
                detail: 'この操作は元に戻せません。すべてのJavaのバージョンが削除されます。',
                buttons: ['はい', 'いいえ'],
                defaultId: 1,
                cancelId: 1,
              }).then(result => {
                if (result.response === 0) {
                  clearDirectory(path.join(userDataDir, 'fluffbox/java_versions'));
                  dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '完了',
                    message: 'Javaのすべてのバージョンが削除されました。',
                  });
                }
              });
            }
            break;
          case "openConfig":
            item.click = () => createConfigWindow();
            break;
          case "openGithub":
            item.click = () => shell.openExternal(`${metaData.githubRepository}`);
            break;
          case "showVersion":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'バージョン情報',
                message: 'FluffBox - バージョン',
                detail: `Version: ${metaData.version}\nDate: ${metaData.date}\nAuthor: ${metaData.author}（${metaData.authorGitHub}）\nRepository: ${metaData.githubRepository}`,
                buttons: ['OK'],
                defaultId: 0,
                icon: path.join(__dirname, 'resources/icon', 'fluffbox.ico')
              });
            }
            break;
          case "showLicense":
            item.click = () => {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'ライセンス',
                message: 'FluffBox - ライセンス情報',
                detail: `${license}`,
                "buttons": ['OK'],
                defaultId: 0,
                icon: path.join(__dirname, 'resources/icon', 'fluffbox.ico')
              });
            }
            break;
          case "openIssue":
            item.click = () => {
              shell.openExternal(`${metaData.githubRepository}/issues`);
            }
            break;
          case "info":
            item.click = () => {
              shell.openExternal("https://www.2237yh.net");
            }
        }
      }
    }
  }
  assignClicks(menu);
  return Menu.buildFromTemplate(menu);
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 760,
    minWidth: 1320,
    minHeight: 760,
    title: 'FluffBox',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(`resources/${lang}/index.html`);
  Menu.setApplicationMenu(loadMenu());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const sendLog = (msg, channel = 'log') => {
    console.log(`[${channel} - Main Process] ${msg}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, msg);
    }
  };

  registerNodeHandlers(ipcMain, sendLog);
  registerPythonHandlers(ipcMain, sendLog);
  registerJavaHandlers(ipcMain, sendLog);

  ipcMain.handle('load-page', (event, pageName) => {
    const pagePath = path.join(__dirname, `resources/${lang}/${pageName}.html`);
    if (fs.existsSync(pagePath)) {
      mainWindow.loadFile(pagePath);
      return true;
    } else {
      mainWindow.loadFile(`resources/${lang}/error.html`);
      console.error(`(´× ω ×｀；)ﾍﾟｰｼﾞｶﾞﾐﾂｶﾘﾏｾﾝ...: ${pagePath}`);
      return false;
    }
  });
};

const createConfigWindow = () => {
  configWindow = new BrowserWindow({
    width: 600,
    height: 400,
    resizable: false,
    title: '設定',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  configWindow.loadFile(`resources/${lang}/config.html`);
  configWindow.setMenu(null);

  configWindow.on('closed', () => {
    configWindow = null;
  });

  ipcMain.handle('set-lang', async (event, selectedLang) => {
    try {
      configManager.set('language', selectedLang);
      configManager.save();
      sendLog(`言語設定を ${selectedLang} に変更しました。再起動が必要です。`, 'main-log');
      dialog.showMessageBox(configWindow, {
        type: 'info',
        title: '言語設定',
        message: '言語設定が変更されました。アプリケーションを再起動してください。'
      });
      app.relaunch();
      app.quit();
      return true;
    } catch (error) {
      sendLog(`言語設定の変更中にエラーが発生しました: ${error.message}`, 'main-log');
      return false;
    }
  });
};

app.once('ready', () => {
  createWindow();
});

app.once('window-all-closed', () => {
  app.quit();
});