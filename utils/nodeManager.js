const { app } = require('electron');
const https = require('https');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const { getOSAndArchInfo, extractAndMoveArchive } = require('./osInfo');

const NODE_ROOT_DIR = path.join(app.getPath('userData'), 'nodejs_versions');
const CURRENT_NODE_SYMLINK_PATH = path.join(NODE_ROOT_DIR, 'current');

/**
 * Node.jsがPATHからアクセス可能かチェック
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const checkNodeAccessible = (sendLog) => {
  return new Promise((resolve) => {
    const { executableExt } = getOSAndArchInfo('node');
    const cmd = `node${executableExt} -V`;

    exec(cmd, async (error, stdout, stderr) => {
      if (!error && !stderr) {
        sendLog(`ℹ️ 現在アクティブなNode.jsバージョン (システムPATHより): ${stdout.trim()}`, 'node-log');
        resolve(true);
      } else {
        if (fsSync.existsSync(CURRENT_NODE_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.readlink(CURRENT_NODE_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_NODE_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(resolvedPath);
            sendLog(`ℹ️ 現在アクティブなNode.jsバージョン: ${activeVersionDirName}\n(シンボリックリンクより)`, 'node-log');
            resolve(true);
          } catch (e) {
            sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${e.message}`, 'node-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ Node.jsはシステムPATHからアクセスできません。`, 'node-log');
          resolve(false);
        }
      }
    });
  });
};

/**
 * 利用可能なバージョンを取得する
 * @param {function(string, string)} sendLog
 * @returns {Promise<Array<Object>>}
 */
const getAvailableNodeVersions = async (sendLog) => {
  try {
    const { os, arch, platformName, archiveExt } = getOSAndArchInfo('node');
    sendLog(`⚙️ 利用可能なNode.jsバージョンを検索中... (OS: ${os}, Arch: ${arch})`, 'node-log');

    return new Promise((resolve, reject) => {
      const request = https.get('https://nodejs.org/dist/index.json', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            sendLog(`❌ Node.jsバージョン情報のAPIからの取得に失敗しました: HTTP Status ${res.statusCode}`, 'node-log');
            return reject(new Error(`Node.jsバージョン情報のAPIからの取得に失敗しました: HTTP Status ${res.statusCode}`));
          }
          try {
            const allVersions = JSON.parse(data);
            const availableForCurrentOS = allVersions
              .filter(v => {
                const hasBinaryForCurrentOS = v.files.some(file => file.includes(`${platformName}-${arch}`));
                return hasBinaryForCurrentOS;
              })
              .map(v => {
                return {
                  version: v.version,
                  lts: v.lts || '',
                  downloadUrl: `https://nodejs.org/dist/${v.version}/node-${v.version}-${platformName}-${arch}${archiveExt}`
                };
              });

            availableForCurrentOS.sort((a, b) => {
              const versionA = parseFloat(a.version.replace('v', ''));
              const versionB = parseFloat(b.version.replace('v', ''));
              return versionB - versionA;
            });

            sendLog(`✅ 利用可能なNode.jsバージョンが見つかりました: ${availableForCurrentOS.length}件`, 'node-log');
            resolve(availableForCurrentOS);
          } catch (e) {
            sendLog(`❌ Node.jsバージョン情報のJSON解析に失敗しました: ${e.message}`, 'node-log');
            reject(new Error('Node.jsバージョン情報のJSON解析に失敗しました。'));
          }
        });
      });
      request.on('error', (e) => {
        sendLog(`❌ Node.jsバージョン情報のAPIからの取得に失敗しました。ネットワーク接続を確認してください: ${e.message}`, 'node-log');
        reject(new Error('Node.jsバージョン情報のAPIからの取得に失敗しました。ネットワーク接続を確認してください。'));
      });
    });
  } catch (error) {
    sendLog(`❌ getAvailableNodeVersionsで予期せぬエラー: ${error.message}`, 'node-log');
    throw error;
  }
};

/**
 * インストール済みのバージョンを取得する
 * @param {function(string, string)} sendLog
 * @returns {Promise<Object>}
 */
const getInstalledNodeVersions = async (sendLog) => {
  try {
    await fs.mkdir(NODE_ROOT_DIR, { recursive: true });
    const entries = await fs.readdir(NODE_ROOT_DIR, { withFileTypes: true });
    const installedVersions = entries
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('v'))
      .map(dirent => dirent.name);

    let currentVersion = null;
    try {
      const stats = await fs.lstat(CURRENT_NODE_SYMLINK_PATH);
      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(CURRENT_NODE_SYMLINK_PATH);
        const resolvedPath = path.resolve(path.dirname(CURRENT_NODE_SYMLINK_PATH), linkTarget);
        currentVersion = path.basename(resolvedPath);
      }
    } catch (e) {
    }
    sendLog(`✅ インストール済みNode.jsバージョンを検出しました: ${installedVersions.join(', ')}`, 'node-log');
    sendLog(`ℹ️ 現在のNode.jsバージョン: ${currentVersion || '未設定'}`, 'node-log');
    return { installed: installedVersions, current: currentVersion };
  } catch (error) {
    sendLog(`❌ インストール済みNode.jsバージョンの取得中にエラー: ${error.message}`, 'node-log');
    throw error;
  }
};

/**
 * Node.jsをインストールする
 * @param {Object} versionInfo
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const installNodeVersion = async (versionInfo, sendLog) => {
  const { version, downloadUrl } = versionInfo;
  const { os } = getOSAndArchInfo('node');
  const fileName = path.basename(downloadUrl);
  const downloadPath = path.join(app.getPath('temp'), fileName);
  const installPath = path.join(NODE_ROOT_DIR, version);

  if (await fs.access(installPath).then(() => true).catch(() => false)) {
    sendLog(`⚠️ Node.js ${version} は既にインストールされています。`, 'node-log');
    return true;
  }

  try {
    await fs.mkdir(installPath, { recursive: true });
    sendLog(`🌐 Node.js ${version} をダウンロード中: ${downloadUrl}`, 'node-log');

    await new Promise((resolve, reject) => {
      const fileStream = fsSync.createWriteStream(downloadPath);
      https.get(downloadUrl, (response) => {
        if (response.statusCode >= 400) {
          reject(new Error(`ダウンロード失敗: HTTP Status ${response.statusCode}`));
          response.resume();
          return;
        }
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(downloadPath).catch(() => { });
        reject(new Error(`ダウンロードエラー: ${err.message}`));
      });
    });

    sendLog(`📦 Node.js ${version} を解凍中...`, 'node-log');
    await extractAndMoveArchive(downloadPath, installPath, os, 'node', sendLog);

    await fs.unlink(downloadPath);
    sendLog(`✅ Node.js ${version} のインストールが完了しました。`, 'node-log');
    return true;
  } catch (error) {
    sendLog(`❌ Node.js ${version} のインストールに失敗しました: ${error.message}`, 'node-log');
    await fs.rm(installPath, { recursive: true, force: true }).catch(e => sendLog(`クリーンアップ失敗: ${e.message}`, 'node-log'));
    throw error;
  }
};

/**
 * 指定されたバージョンをアクティブにする
 * @param {string} version
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const useNodeVersion = async (version, sendLog) => {
  const targetPath = path.join(NODE_ROOT_DIR, version);
  const { os } = getOSAndArchInfo('node');

  try {
    await fs.access(targetPath);

    try {
      await fs.unlink(CURRENT_NODE_SYMLINK_PATH);
      sendLog(`ℹ️ 既存のシンボリックリンクを削除しました。`, 'node-log');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        sendLog(`❌ シンボリックリンク削除中にエラー: ${e.message}`, 'node-log');
        throw e;
      }
    }

    const symlinkType = (os === 'win32') ? 'junction' : 'dir';
    await fs.symlink(targetPath, CURRENT_NODE_SYMLINK_PATH, symlinkType);
    sendLog(`✅ Node.jsバージョンを ${version} に設定しました。`, 'node-log');

    return true;
  } catch (error) {
    sendLog(`❌ Node.js ${version} の設定に失敗しました: ${error.message}`, 'node-log');
    throw error;
  }
};



/**
 * 指定されたNode.jsバージョンを削除する
 * @param {string} versionToDelete
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const deleteNodeVersion = async (versionToDelete, sendLog) => {
  sendLog(`⚙️ Node.js ${versionToDelete} の削除を開始します...`, 'node-log');
  const versionPath = path.join(NODE_ROOT_DIR, versionToDelete);

  try {
    await fs.access(versionPath);
  } catch (e) {
    sendLog(`❌ Node.js ${versionToDelete} は見つかりませんでした。`, 'node-log');
    throw new Error('指定されたNode.jsバージョンは存在しません。');
  }

  try {
    const stats = await fs.lstat(CURRENT_NODE_SYMLINK_PATH);
    if (stats.isSymbolicLink()) {
      const activeTargetPath = await fs.readlink(CURRENT_NODE_SYMLINK_PATH);
      const resolvedActivePath = path.resolve(path.dirname(CURRENT_NODE_SYMLINK_PATH), activeTargetPath);
      if (resolvedActivePath === versionPath) {
        sendLog(`⚠️ Node.js ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'node-log');
        throw new Error('アクティブなバージョンは削除できません。');
      }
    }
  } catch (symlinkError) {
    if (symlinkError.code !== 'ENOENT') {
      sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'node-log');
      throw symlinkError;
    }
  }

  try {
    sendLog(`🗑️ ${versionPath} を削除中...`, 'node-log');
    await fs.rm(versionPath, { recursive: true, force: true });
    sendLog(`✅ Node.js ${versionToDelete} の削除が完了しました。`, 'node-log');
    return true;
  } catch (error) {
    sendLog(`❌ Node.jsバージョン削除中にエラーが発生しました: ${error.message}`, 'node-log');
    throw error;
  }
};

/**
 * Node.jsコマンドを実行する
 * @param {string} command
 * @param {Array<string>} args
 * @param {function(string, string)} sendLog
 * @returns {Promise<string>}
 */
const runNodeCommand = (command, args, sendLog) => {
  return new Promise((resolve, reject) => {
    const { executableExt } = getOSAndArchInfo('node');
    const cmd = `${command}${executableExt}`;

    const execOptions = {
      env: {
        ...process.env,
        PATH: `${path.join(CURRENT_NODE_SYMLINK_PATH, 'bin')}${path.delimiter}${process.env.PATH}`
      }
    };

    sendLog(`🚀 コマンド実行: ${cmd} ${args.join(' ')}`, 'node-log');
    exec(`${cmd} ${args.join(' ')}`, execOptions, (error, stdout, stderr) => {
      if (error) {
        sendLog(`❌ コマンド実行エラー: ${error.message}`, 'node-log');
        sendLog(`Stderr: ${stderr}`, 'node-log');
        return reject(new Error(`コマンド実行失敗: ${error.message}\n${stderr}`));
      }
      if (stderr) {
        sendLog(`⚠️ コマンドStderr: ${stderr}`, 'node-log');
      }
      sendLog(`✅ コマンドStdout:\n${stdout}`, 'node-log');
      resolve(stdout);
    });
  });
};


/**
 * ハンドラを登録する関数
 * @param {object} ipcMain
 * @param {function(string, string)} sendLog
 */
const registerNodeHandlers = (ipcMain, sendLog) => {
  ipcMain.handle('check-node-accessible', () => checkNodeAccessible(sendLog));
  ipcMain.handle('get-available-node-versions', () => getAvailableNodeVersions(sendLog));
  ipcMain.handle('get-installed-node-versions', () => getInstalledNodeVersions(sendLog));
  ipcMain.handle('install-node-version', (event, versionInfo) => installNodeVersion(versionInfo, sendLog));
  ipcMain.handle('delete-node-version', (event, versionToDelete) => deleteNodeVersion(versionToDelete, sendLog));
  ipcMain.handle('use-node-version', (event, version) => useNodeVersion(version, sendLog));
  ipcMain.handle('run-node-command', (event, command, args) => runNodeCommand(command, args, sendLog));
};

module.exports = {
  registerNodeHandlers,
  checkNodeAccessible,
  getAvailableNodeVersions,
  getInstalledNodeVersions,
  installNodeVersion,
  deleteNodeVersion,
  useNodeVersion,
  runNodeCommand
};
