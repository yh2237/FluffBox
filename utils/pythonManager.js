const { app } = require('electron');
const https = require('https');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { getOSAndArchInfo, extractAndMoveArchive } = require('./osInfo');

const PYTHON_ROOT_DIR = path.join(app.getPath('userData'), 'python_versions');
const CURRENT_PYTHON_SYMLINK_PATH = path.join(PYTHON_ROOT_DIR, 'current');

/**
 * PythonがPATHからアクセス可能かチェックする関数
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const checkPythonAccessible = (sendLog) => {
  return new Promise((resolve) => {
    exec('python -V', async (error, stdout, stderr) => {
      if (!error && !stderr) {
        sendLog(`ℹ️ 現在アクティブなPythonバージョン (システムPATHより): ${stdout.trim()}`, 'python-log');
        resolve(true);
      } else {
        if (fsSync.existsSync(CURRENT_PYTHON_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.readlink(CURRENT_PYTHON_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_PYTHON_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(resolvedPath);
            sendLog(`ℹ️ 現在アクティブなPythonバージョン: ${activeVersionDirName}\n(シンボリックリンクより)`, 'python-log');
            resolve(true);
          } catch (e) {
            sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${e.message}`, 'python-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ PythonはシステムPATHからアクセスできません。`, 'python-log');
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
const getAvailablePythonVersions = async (sendLog) => {
  try {
    sendLog(`⚙️ 利用可能なPythonバージョンを取得中...`, 'python-log');

    const urls = [
      'https://www.python.org/ftp/python/index-windows-recent.json',
      'https://www.python.org/ftp/python/index-windows-legacy.json'
    ];

    const arch = process.arch === 'x64' ? 'amd64' : 'win32';
    let versions = [];

    for (const url of urls) {
      const jsonData = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`JSONパース失敗: ${e.message}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        }).on('error', reject);
      });

      const filtered = jsonData.versions
        .filter(entry =>
          (entry.company === 'PythonEmbed' || entry.company === 'PythonCore') &&
          entry.url.includes(`${arch}.zip`) &&
          !entry['sort-version'].match(/(a|b|rc|dev|post)/)
        )
        .map(entry => ({
          version: entry['sort-version'],
          downloadUrl: entry.url,
          fileName: path.basename(entry.url)
        }));

      versions.push(...filtered);
    }

    const unique = {};
    versions.forEach(v => {
      const key = v.version;
      if (!unique[key] || compareVersions(v.version, unique[key].version) > 0) {
        unique[key] = v;
      }
    });

    const sortedVersions = Object.values(unique).sort((a, b) => compareVersions(b.version, a.version)).reverse();

    sendLog(`✅ 利用可能なPythonバージョンが見つかりました: ${sortedVersions.length}件`, 'python-log');
    return sortedVersions;
  } catch (error) {
    sendLog(`❌ getAvailablePythonVersionsで予期せぬエラー: ${error.message}`, 'python-log');
    throw error;
  }
};

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}


/**
 * インストール済みのバージョンを取得する
 * @param {function(string, string)} sendLog
 * @returns {Promise<Object>}
 */
const getInstalledPythonVersions = async (sendLog) => {
  try {
    await fs.mkdir(PYTHON_ROOT_DIR, { recursive: true });
    const entries = await fs.readdir(PYTHON_ROOT_DIR, { withFileTypes: true });
    const installedVersions = entries
      .filter(dirent => dirent.isDirectory() && dirent.name.match(/^\d+\.\d+\.\d+$/))
      .map(dirent => dirent.name);

    let currentVersion = null;
    try {
      const stats = await fs.lstat(CURRENT_PYTHON_SYMLINK_PATH);
      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(CURRENT_PYTHON_SYMLINK_PATH);
        const resolvedPath = path.resolve(path.dirname(CURRENT_PYTHON_SYMLINK_PATH), linkTarget);
        currentVersion = path.basename(resolvedPath);
      }
    } catch (e) {
    }
    sendLog(`✅ インストール済みPythonバージョンを検出しました: ${installedVersions.join(', ')}`, 'python-log');
    sendLog(`ℹ️ 現在のPythonバージョン: ${currentVersion || '未設定'}`, 'python-log');
    return { installed: installedVersions, current: currentVersion };
  } catch (error) {
    sendLog(`❌ インストール済みPythonバージョンの取得中にエラー: ${error.message}`, 'python-log');
    throw error;
  }
};

/**
 * Pythonをインストールする
 * @param {Object} versionInfo
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const installPythonVersion = async (versionInfo, sendLog) => {
  const { version, downloadUrl, fileName } = versionInfo;
  const { os } = getOSAndArchInfo('python');
  const downloadPath = path.join(app.getPath('temp'), fileName);
  const installPath = path.join(PYTHON_ROOT_DIR, version);

  if (await fs.access(installPath).then(() => true).catch(() => false)) {
    sendLog(`⚠️ Python ${version} は既にインストールされています。`, 'python-log');
    return true;
  }

  try {
    await fs.mkdir(installPath, { recursive: true });
    sendLog(`🌐 Python ${version} をダウンロード中: ${downloadUrl}`, 'python-log');

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

    if (os === 'win32' && fileName.endsWith('.exe')) {
      sendLog(`📦 Windowsインストーラを実行中: ${downloadPath}`, 'python-log');
      await new Promise((resolve, reject) => {

        exec(`"${downloadPath}" /quiet InstallAllUsers=1 PrependPath=1`, (error, stdout, stderr) => {
          if (error) {
            sendLog(`❌ インストーラ実行エラー: ${stderr || stdout}`, 'python-log');
            return reject(error);
          }
          sendLog(`✅ Windowsインストーラ実行完了。`, 'python-log');

          resolve();
        });
      });
    } else {
      sendLog(`📦 Python ${version} を解凍中...`, 'python-log');
      await extractAndMoveArchive(downloadPath, installPath, os, 'python', sendLog);
    }

    await fs.unlink(downloadPath);
    sendLog(`✅ Python ${version} のインストールが完了しました。`, 'python-log');
    return true;
  } catch (error) {
    sendLog(`❌ Python ${version} のインストールに失敗しました: ${error.message}`, 'python-log');
    await fs.rm(installPath, { recursive: true, force: true }).catch(e => sendLog(`クリーンアップ失敗: ${e.message}`, 'python-log'));
    throw error;
  }
};

/**
 * 指定されたバージョンをアクティブにする
 * @param {string} version
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const usePythonVersion = async (version, sendLog) => {
  const targetPath = path.join(PYTHON_ROOT_DIR, version);
  const { os } = getOSAndArchInfo('python');

  try {
    await fs.access(targetPath);

    try {
      await fs.unlink(CURRENT_PYTHON_SYMLINK_PATH);
      sendLog(`ℹ️ 既存のシンボリックリンクを削除しました。`, 'python-log');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        sendLog(`❌ シンボリックリンク削除中にエラー: ${e.message}`, 'python-log');
        throw e;
      }
    }

    const symlinkType = (os === 'win32') ? 'junction' : 'dir';
    await fs.symlink(targetPath, CURRENT_PYTHON_SYMLINK_PATH, symlinkType);
    sendLog(`✅ Pythonバージョンを ${version} に設定しました。`, 'python-log');
    return true;
  } catch (error) {
    sendLog(`❌ Python ${version} の設定に失敗しました: ${error.message}`, 'python-log');
    throw error;
  }
};


/**
 * 指定されたバージョンを削除する
 * @param {string} versionToDelete
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const deletePythonVersion = async (versionToDelete, sendLog) => {
  sendLog(`⚙️ Python ${versionToDelete} の削除を開始します...`, 'python-log');
  const versionPath = path.join(PYTHON_ROOT_DIR, versionToDelete);

  try {
    await fs.access(versionPath);
  } catch (e) {
    sendLog(`❌ Python ${versionToDelete} は見つかりませんでした。`, 'python-log');
    throw new Error('指定されたPythonバージョンは存在しません。');
  }

  try {
    const stats = await fs.lstat(CURRENT_PYTHON_SYMLINK_PATH);
    if (stats.isSymbolicLink()) {
      const activeTargetPath = await fs.readlink(CURRENT_PYTHON_SYMLINK_PATH);
      const resolvedActivePath = path.resolve(path.dirname(CURRENT_PYTHON_SYMLINK_PATH), activeTargetPath);
      if (resolvedActivePath === versionPath) {
        sendLog(`⚠️ Python ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'python-log');
        throw new Error('アクティブなバージョンは削除できません。');
      }
    }
  } catch (symlinkError) {
    if (symlinkError.code !== 'ENOENT') {
      sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'python-log');
      throw symlinkError;
    }
  }

  try {
    sendLog(`🗑️ ${versionPath} を削除中...`, 'python-log');
    await fs.rm(versionPath, { recursive: true, force: true });
    sendLog(`✅ Python ${versionToDelete} の削除が完了しました。`, 'python-log');
    return true;
  } catch (error) {
    sendLog(`❌ Pythonバージョン削除中にエラーが発生しました: ${error.message}`, 'python-log');
    throw error;
  }
};

/**
 * ハンドラを登録する
 * @param {object} ipcMain
 * @param {function(string, string)} sendLog
 */
const registerPythonHandlers = (ipcMain, sendLog) => {
  ipcMain.handle('check-python-accessible', () => checkPythonAccessible(sendLog));
  ipcMain.handle('get-available-python-versions', () => getAvailablePythonVersions(sendLog));
  ipcMain.handle('get-installed-python-versions', () => getInstalledPythonVersions(sendLog));
  ipcMain.handle('install-python-version', (event, versionInfo) => installPythonVersion(versionInfo, sendLog));
  ipcMain.handle('delete-python-version', (event, versionToDelete) => deletePythonVersion(versionToDelete, sendLog));
  ipcMain.handle('use-python-version', (event, version) => usePythonVersion(version, sendLog));
};

module.exports = {
  registerPythonHandlers,
  checkPythonAccessible,
  getAvailablePythonVersions,
  getInstalledPythonVersions,
  installPythonVersion,
  deletePythonVersion,
  usePythonVersion
};
