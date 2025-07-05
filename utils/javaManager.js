const { app } = require('electron');
const { https } = require('follow-redirects');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { getOSAndArchInfo, extractAndMoveArchive } = require('./osInfo');

const JAVA_ROOT_DIR = path.join(app.getPath('userData'), 'java_versions');
const CURRENT_JAVA_SYMLINK_PATH = path.join(JAVA_ROOT_DIR, 'current');

/**
 * PATHからアクセス可能かチェックする
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const checkJavaAccessible = (sendLog) => {
  return new Promise((resolve) => {
    const { executableExt } = getOSAndArchInfo('java');
    const cmd = `java${executableExt} -version`;

    exec(cmd, async (error, stdout, stderr) => {
      if (!error && (stdout || stderr)) {
        sendLog(`ℹ️ 現在アクティブなJavaバージョン (システムPATHより):\n${stdout || stderr}`.trim(), 'java-log');
        resolve(true);
      } else {
        if (fsSync.existsSync(CURRENT_JAVA_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.readlink(CURRENT_JAVA_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_JAVA_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(path.dirname(resolvedPath));
            sendLog(`ℹ️ 現在アクティブなJavaバージョン: ${activeVersionDirName}\n(シンボリックリンクより)`, 'java-log');
            resolve(true);
          } catch (e) {
            sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${e.message}`, 'java-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ JavaはシステムPATHからアクセスできません。`, 'java-log');
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
const getAvailableJavaVersions = async (sendLog) => {
  try {
    const { os, arch, jvmImpl } = getOSAndArchInfo('java');
    const platformName = os === 'win32' ? 'windows' : os === 'darwin' ? 'mac' : os;
    sendLog(`⚙️ 利用可能なJavaバージョンを検索中... (OS: ${os}, Arch: ${arch}, Platform: ${platformName})`, 'java-log');

    const ltsReleases = [8, 11, 17, 21, 22, 23, 24];
    const results = [];

    for (const release of ltsReleases) {
      const url = `https://api.adoptium.net/v3/assets/feature_releases/${release}/ga?architecture=${arch}&heap_size=normal&image_type=jdk&jvm_impl=${jvmImpl}&os=${platformName}&project=jdk`;
      try {
        const data = await new Promise((resolve, reject) => {
          https.get(url, (res) => {
            let raw = '';
            res.on('data', (chunk) => raw += chunk);
            res.on('end', () => res.statusCode === 200 ? resolve(raw) : reject(new Error(`HTTP ${res.statusCode}`)));
          }).on('error', reject);
        });

        const assets = JSON.parse(data);
        for (const asset of assets) {
          const binary = asset.binaries.find(b => b.package.name.endsWith('.zip'));
          if (binary) {
            results.push({
              version: asset.version_data.semver,
              full_version: asset.openjdk_version,
              downloadUrl: binary.package.link,
              fileName: binary.package.name,
              release_name: `jdk-${asset.version_data.semver}+${asset.version_data.build}`
            });
          }
        }
      } catch (e) {
        sendLog(`⚠️ Java ${release} の取得に失敗: ${e.message}`, 'java-log');
      }
    }

    results.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    sendLog(`✅ 利用可能なJavaバージョンが見つかりました: ${results.length}件`, 'java-log');
    return results;
  } catch (error) {
    sendLog(`❌ getAvailableJavaVersionsで予期せぬエラー: ${error.message}`, 'java-log');
    throw error;
  }
};

/**
 * インストール済みのバージョンを取得する
 * @param {function(string, string)} sendLog
 * @returns {Promise<Object>}
 */
const getInstalledJavaVersions = async (sendLog) => {
  try {
    await fs.mkdir(JAVA_ROOT_DIR, { recursive: true });
    const entries = await fs.readdir(JAVA_ROOT_DIR, { withFileTypes: true });
    const installedVersions = entries
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('jdk-'))
      .map(dirent => dirent.name);

    let currentVersion = null;
    try {
      const stats = await fs.lstat(CURRENT_JAVA_SYMLINK_PATH);
      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(CURRENT_JAVA_SYMLINK_PATH);
        const resolvedPath = path.resolve(path.dirname(CURRENT_JAVA_SYMLINK_PATH), linkTarget);
        currentVersion = path.basename(resolvedPath);
      }
    } catch (e) {
    }
    sendLog(`✅ インストール済みJavaバージョンを検出しました: ${installedVersions.join(', ')}`, 'java-log');
    sendLog(`ℹ️ 現在のJavaバージョン: ${currentVersion || '未設定'}`, 'java-log');
    return { installed: installedVersions, current: currentVersion };
  } catch (error) {
    sendLog(`❌ インストール済みJavaバージョンの取得中にエラー: ${error.message}`, 'java-log');
    throw error;
  }
};

/**
 * 指定されたバージョンをインストールする
 * @param {Object} versionInfo
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const installJavaVersion = async (versionInfo, sendLog) => {
  const { version, downloadUrl, fileName, release_name } = versionInfo;
  const { os } = getOSAndArchInfo('java');
  const downloadPath = path.join(app.getPath('temp'), fileName);
  const installPath = path.join(JAVA_ROOT_DIR, release_name);

  if (await fs.access(installPath).then(() => true).catch(() => false)) {
    sendLog(`⚠️ Java ${release_name} は既にインストールされています。`, 'java-log');
    return true;
  }

  try {
    await fs.mkdir(installPath, { recursive: true });
    sendLog(`🌐 Java ${release_name} をダウンロード中: ${downloadUrl}`, 'java-log');

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

    sendLog(`📦 Java ${release_name} を解凍中...`, 'java-log');
    await extractAndMoveArchive(downloadPath, installPath, os, 'java', sendLog);

    await fs.unlink(downloadPath);
    sendLog(`✅ Java ${release_name} のインストールが完了しました。`, 'java-log');
    return true;
  } catch (error) {
    sendLog(`❌ Java ${release_name} のインストールに失敗しました: ${error.message}`, 'java-log');
    await fs.rm(installPath, { recursive: true, force: true }).catch(e => sendLog(`クリーンアップ失敗: ${e.message}`, 'java-log'));
    throw error;
  }
};

/**
 * 指定されたバージョンをアクティブにする
 * @param {string} version
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const useJavaVersion = async (version, sendLog) => {
  const targetJavaHomePath = path.join(JAVA_ROOT_DIR, version);
  const { os } = getOSAndArchInfo('java');

  try {
    await fs.access(targetJavaHomePath);

    try {
      await fs.unlink(CURRENT_JAVA_SYMLINK_PATH);
      sendLog(`ℹ️ 既存のシンボリックリンクを削除しました。`, 'java-log');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    const symlinkType = (os === 'win32') ? 'junction' : 'dir';
    await fs.symlink(targetJavaHomePath, CURRENT_JAVA_SYMLINK_PATH, symlinkType);
    sendLog(`✅ Javaバージョンを ${version} に設定しました。`, 'java-log');
    return true;
  } catch (error) {
    sendLog(`❌ Java ${version} の設定に失敗しました: ${error.message}`, 'java-log');
    throw error;
  }
};

/**
 * 指定されたバージョンを削除する
 * @param {string} versionToDelete
 * @param {function(string, string)} sendLog
 * @returns {Promise<boolean>}
 */
const deleteJavaVersion = async (versionToDelete, sendLog) => {
  sendLog(`⚙️ Java ${versionToDelete} の削除を開始します...`, 'java-log');
  const versionPath = path.join(JAVA_ROOT_DIR, versionToDelete);

  try {
    await fs.access(versionPath);
  } catch (e) {
    sendLog(`❌ Java ${versionToDelete} は見つかりませんでした。`, 'java-log');
    throw new Error('指定されたJavaバージョンは存在しません。');
  }

  try {
    const stats = await fs.lstat(CURRENT_JAVA_SYMLINK_PATH);
    if (stats.isSymbolicLink()) {
      const activeTargetPath = await fs.readlink(CURRENT_JAVA_SYMLINK_PATH);
      const resolvedActivePath = path.resolve(path.dirname(CURRENT_JAVA_SYMLINK_PATH), activeTargetPath);
      if (resolvedActivePath === versionPath) {
        sendLog(`⚠️ Java ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'java-log');
        throw new Error('アクティブなバージョンは削除できません。');
      }
    }
  } catch (symlinkError) {
    if (symlinkError.code !== 'ENOENT') {
      sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'java-log');
      throw symlinkError;
    }
  }

  try {
    sendLog(`🗑️ ${versionPath} を削除中...`, 'java-log');
    await fs.rm(versionPath, { recursive: true, force: true });
    sendLog(`✅ Java ${versionToDelete} の削除が完了しました。`, 'java-log');
    return true;
  } catch (error) {
    sendLog(`❌ Javaバージョン削除中にエラーが発生しました: ${error.message}`, 'java-log');
    throw error;
  }
};

/**
 * ハンドラ登録
 * @param {object} ipcMain
 * @param {function(string, string)} sendLog
 */
const registerJavaHandlers = (ipcMain, sendLog) => {
  ipcMain.handle('check-java-accessible', () => checkJavaAccessible(sendLog));
  ipcMain.handle('get-available-java-versions', () => getAvailableJavaVersions(sendLog));
  ipcMain.handle('get-installed-java-versions', () => getInstalledJavaVersions(sendLog));
  ipcMain.handle('install-java-version', (event, versionInfo) => installJavaVersion(versionInfo, sendLog));
  ipcMain.handle('delete-java-version', (event, versionToDelete) => deleteJavaVersion(versionToDelete, sendLog));
  ipcMain.handle('use-java-version', (event, version) => useJavaVersion(version, sendLog));
};

module.exports = {
  registerJavaHandlers,
  checkJavaAccessible,
  getAvailableJavaVersions,
  getInstalledJavaVersions,
  installJavaVersion,
  deleteJavaVersion,
  useJavaVersion
};
