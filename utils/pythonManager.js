const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const PYTHON_ROOT_DIR = path.join(app.getPath('userData'), 'python_versions');
const CURRENT_PYTHON_SYMLINK_PATH = path.join(PYTHON_ROOT_DIR, 'current');

/**
 * PythonがPATHからアクセス可能かチェックする関数
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<boolean>} Pythonがアクセス可能かどうか
 */
const checkPythonAccessible = (sendLog) => {
  return new Promise((resolve) => {
    exec('python -V', async (error, stdout, stderr) => {
      if (!error && !stderr) {
        sendLog(`ℹ️ 現在アクティブなPythonバージョン (システムPATHより): ${stdout.trim()}`, 'python-log');
        resolve(true);
      } else {
        if (fs.existsSync(CURRENT_PYTHON_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.promises.readlink(CURRENT_PYTHON_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_PYTHON_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(resolvedPath);
            sendLog(`ℹ️ 現在アクティブなPythonバージョン: ${activeVersionDirName}\n(システムPATHへの反映にはターミナルの再起動が必要です)`, 'python-log');
            resolve(true);
          } catch (symlinkError) {
            sendLog(`ℹ️ シンボリックリンクの確認中にエラー: ${symlinkError.message})`, 'python-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ 現在のシステムPATHではPythonにアクセスできません。`, 'python-log');
          resolve(false);
        }
      }
    });
  });
};

/**
 * インストール済みPythonバージョンをリストする関数
 * @returns {Promise<string[]>} インストール済みPythonバージョンの配列
 */
const getInstalledPythonVersions = async () => {
  if (!fs.existsSync(PYTHON_ROOT_DIR)) {
    return [];
  }
  const directories = await fs.promises.readdir(PYTHON_ROOT_DIR, { withFileTypes: true });
  return directories
    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('Python'))
    .map(dirent => dirent.name.replace('Python', 'v'));
};

/**
 * シンボリックリンクとPATHを更新
 * @param {string} targetVersionName - 切り替えるPythonのバージョン名
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<void>}
 */
const updateCurrentPythonSymlinkAndPath = async (targetVersionName, sendLog) => {
  const majorMinorVersion = targetVersionName.replace('v', '').split('.').slice(0, 2).join('');
  const targetPythonDirName = `Python${majorMinorVersion}`;
  const targetPythonPath = path.join(PYTHON_ROOT_DIR, targetPythonDirName);

  const pythonExePath = path.join(targetPythonPath, 'python.exe');
  const scriptsPath = path.join(targetPythonPath, 'Scripts');

  if (!fs.existsSync(pythonExePath)) {
    throw new Error(`${targetVersionName} (${targetPythonDirName}) のPython実行ファイルが見つかりません。インストールが不完全な可能性があります。`);
  }

  try {
    if (fs.existsSync(CURRENT_PYTHON_SYMLINK_PATH)) {
      sendLog('🔗 既存のPythonシンボリックリンクを削除中...', 'python-log');
      await fs.promises.unlink(CURRENT_PYTHON_SYMLINK_PATH);
    }

    sendLog(`🔗 ${targetVersionName} へのPythonシンボリックリンクを作成中...`, 'python-log');
    await fs.promises.symlink(targetPythonPath, CURRENT_PYTHON_SYMLINK_PATH, 'junction');
    sendLog('✅ Pythonシンボリックリンクの作成が完了しました。', 'python-log');

    const currentPath = process.env.PATH || '';
    const newPathEntries = [
      CURRENT_PYTHON_SYMLINK_PATH,
      path.join(CURRENT_PYTHON_SYMLINK_PATH, 'Scripts')
    ];

    const pathParts = currentPath.split(path.delimiter).filter(p => {
      return !p.toLowerCase().includes('python') && !p.toLowerCase().includes(PYTHON_ROOT_DIR.toLowerCase());
    });

    let updatedPath = [...newPathEntries, ...pathParts].join(path.delimiter);

    if (updatedPath.length > 1024) {
      sendLog('⚠️ PATH環境変数が非常に長くなっています。一部が切り詰められる可能性があります。', 'python-log');
    }

    sendLog(`Python PATH環境変数を更新中... (設定するPATH: ${updatedPath})`, 'python-log');

    await new Promise((resolve, reject) => {
      exec(`setx PATH "${updatedPath}"`, { encoding: 'shiftjis' }, (err, stdout, stderr) => {
        if (err) {
          sendLog(`❌ Python PATH環境変数の設定に失敗しました: ${err.message}\n` +
            `stdout: ${stdout}\nstderr: ${stderr}`, 'python-log');
          reject(err);
        } else {
          if (stdout || stderr) {
            sendLog(`ℹ️ setx (Python) からのメッセージ:\nstdout: ${stdout}\nstderr: ${stderr}`, 'python-log');
          }
          sendLog('✅ Python PATH環境変数が更新されました。', 'python-log');
          sendLog('ターミナルを再起動することをお勧めします。', 'python-log');
          resolve();
        }
      });
    });

  } catch (error) {
    sendLog(`❌ Pythonバージョン切り替え中にエラーが発生しました: ${error.message}`, 'python-log');
    throw error;
  }
};

/**
 * @param {object} ipcMain - Electronのやつ
 * @param {function(string, string)} sendLog - ログを送信する関数
 */
const registerPythonHandlers = (ipcMain, sendLog) => {
  // 利用可能なPythonのバージョンリストを取得するハンドラ
  ipcMain.handle('get-python-versions', async () => {
    try {
      const url = 'https://www.python.org/ftp/python/index-windows.json';
      sendLog(`バージョン情報を取得中: ${url}`, 'python-log');
      const data = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(rawData);
            } else {
              reject(new Error(`HTTPエラー ${res.statusCode}: ${res.statusMessage || ''}`));
            }
          });
        }).on('error', (err) => reject(err));
      });

      const json = JSON.parse(data);

      const archFilter = process.arch === 'x64' ? 'amd64' : (process.arch === 'arm64' ? 'arm64' : 'win32');

      const versions = json.versions
        .filter(entry =>
          (entry.company === 'PythonEmbed' || entry.company === 'PythonCore') &&
          entry.url.includes(`${archFilter}.zip`) && // Dynamically use archFilter for zip extension
          !entry['sort-version'].includes('a') &&
          !entry['sort-version'].includes('b') &&
          !entry['sort-version'].includes('rc') &&
          !entry['sort-version'].includes('dev') &&
          !entry['sort-version'].includes('post')
        )
        .map(entry => `v${entry['sort-version']}`)
        .filter((v, i, self) => self.indexOf(v) === i)
        .sort((a, b) => {
          const aParts = a.replace('v', '').split('.').map(Number);
          const bParts = b.replace('v', '').split('.').map(Number);
          for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const numA = aParts[i] || 0;
            const numB = bParts[i] || 0;
            if (numA !== numB) {
              return numB - numA;
            }
          }
          return 0;
        });

      const installedVersions = await getInstalledPythonVersions();
      await checkPythonAccessible(sendLog);

      return { available: versions, installed: installedVersions };
    } catch (e) {
      console.error('Pythonバージョン取得エラー:', e);
      sendLog(`❌ Pythonバージョン取得に失敗: ${e.message}`, 'python-log');
      throw new Error(`Pythonバージョン取得に失敗: ${e.message}`);
    }
  });


  // をダウンロード・解凍・セットアップするハンドラ
  ipcMain.handle('install-python-version', async (event, selectedVersion) => {
    sendLog(`⚙️ Python ${selectedVersion} のインストールを開始します...`, 'python-log');

    const versionNumber = selectedVersion.replace('v', '');
    const majorMinorVersion = versionNumber.split('.').slice(0, 2).join('');
    const targetPythonDirName = `Python${majorMinorVersion}`;
    const installPath = path.join(PYTHON_ROOT_DIR, targetPythonDirName);

    if (fs.existsSync(installPath)) {
      sendLog(`⚠️ Python ${selectedVersion} は既にこのツールで管理されています。`, 'python-log');
      return 'already_managed';
    }

    const arch = process.arch === 'x64' ? 'amd64' : (process.arch === 'arm64' ? 'arm64' : 'win32');

    let downloadUrl = '';
    try {
      const jsonUrl = 'https://www.python.org/ftp/python/index-windows.json';
      const data = await new Promise((resolve, reject) => {
        https.get(jsonUrl, (res) => {
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(rawData);
            } else {
              reject(new Error(`HTTPエラー ${res.statusCode}: ${res.statusMessage || ''}`));
            }
          });
        }).on('error', (err) => reject(err));
      });
      const json = JSON.parse(data);

      const targetEntry = json.versions.find(entry =>
        `v${entry['sort-version']}` === selectedVersion &&
        (entry.company === 'PythonEmbed' || entry.company === 'PythonCore') &&
        entry.url.includes(`${arch}.zip`) &&
        !entry['sort-version'].includes('a') &&
        !entry['sort-version'].includes('b') &&
        !entry['sort-version'].includes('rc') &&
        !entry['sort-version'].includes('dev') &&
        !entry['sort-version'].includes('post')
      );

      if (targetEntry && targetEntry.url) {
        downloadUrl = targetEntry.url;
      } else {
        throw new Error(`ダウンロードURLが見つかりませんでした。バージョン: ${selectedVersion}, アーキテクチャ: ${arch}`);
      }

    } catch (e) {
      sendLog(`❌ ダウンロードURL取得エラー: ${e.message}`, 'python-log');
      throw e;
    }

    const tempDownloadPath = path.join(app.getPath('temp'), `python-${versionNumber}-download.zip`);

    try {
      if (!fs.existsSync(PYTHON_ROOT_DIR)) {
        await fs.promises.mkdir(PYTHON_ROOT_DIR, { recursive: true });
      }

      sendLog(`ダウンロード開始: ${downloadUrl}`, 'python-log');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempDownloadPath);
        https.get(downloadUrl, (res) => {
          if (res.statusCode !== 200) {
            file.destroy();
            return reject(new Error(`ダウンロード失敗。HTTP ${res.statusCode}: ${res.statusMessage || ''}`));
          }
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
          fs.unlink(tempDownloadPath, (unlinkErr) => {
            if (unlinkErr) console.error('一時ファイルの削除に失敗しました:', unlinkErr);
            reject(err);
          });
        });
      });

      sendLog(`✅ ダウンロード完了`, 'python-log');
      sendLog(`📦 解凍中...`, 'python-log');

      const zip = new AdmZip(tempDownloadPath);
      await fs.promises.mkdir(installPath, { recursive: true });
      zip.extractAllTo(installPath, true);

      sendLog(`✅ 解凍完了: ${installPath}`, 'python-log');
      await updateCurrentPythonSymlinkAndPath(selectedVersion, sendLog);

      sendLog(`✅ Python ${selectedVersion} のセットアップ完了`, 'python-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ エラー発生: ${error.message}`, 'python-log');
      throw error;
    } finally {
      if (fs.existsSync(tempDownloadPath)) {
        fs.unlink(tempDownloadPath, () => { });
      }
    }
  });


  // 指定されたバージョンに切り替えるハンドラ
  ipcMain.handle('switch-python-version', async (event, targetVersion) => {
    sendLog(`⚙️ Python ${targetVersion} への切り替えを開始します...`, 'python-log');

    const majorMinorVersion = targetVersion.replace('v', '').split('.').slice(0, 2).join('');
    const targetPythonDirName = `Python${majorMinorVersion}`;
    const installPath = path.join(PYTHON_ROOT_DIR, targetPythonDirName);

    if (!fs.existsSync(installPath)) {
      sendLog(`❌ ${targetVersion} はインストールされていません。まずインストールしてください。`, 'python-log');
      throw new Error('指定されたPythonバージョンはインストールされていません。');
    }

    try {
      await updateCurrentPythonSymlinkAndPath(targetVersion, sendLog);
      sendLog(`✅ Python ${targetVersion} への切り替えが完了しました。`, 'python-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Pythonバージョン切り替え中にエラーが発生しました: ${error.message}`, 'python-log');
      throw error;
    }
  });

  // 指定されたバージョンを削除するハンドラ
  ipcMain.handle('delete-python-version', async (event, versionToDelete) => {
    sendLog(`⚙️ Python ${versionToDelete} の削除を開始します...`, 'python-log');
    const majorMinorVersion = versionToDelete.replace('v', '').split('.').slice(0, 2).join('');
    const targetPythonDirName = `Python${majorMinorVersion}`;
    const versionPath = path.join(PYTHON_ROOT_DIR, targetPythonDirName);

    if (!fs.existsSync(versionPath)) {
      sendLog(`❌ Python ${versionToDelete} は見つかりませんでした。`, 'python-log');
      throw new Error('指定されたPythonバージョンは存在しません。');
    }

    if (fs.existsSync(CURRENT_PYTHON_SYMLINK_PATH)) {
      try {
        const activeTargetPath = await fs.promises.readlink(CURRENT_PYTHON_SYMLINK_PATH);
        const resolvedActivePath = path.resolve(path.dirname(CURRENT_PYTHON_SYMLINK_PATH), activeTargetPath);
        if (resolvedActivePath === versionPath) {
          sendLog(`⚠️ Python ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'python-log');
          throw new Error('アクティブなバージョンは削除できません。');
        }
      } catch (symlinkError) {
        sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'python-log');
      }
    }

    try {
      sendLog(`🗑️ ${versionPath} を削除中...`, 'python-log');
      await fs.promises.rm(versionPath, { recursive: true, force: true });
      sendLog(`✅ Python ${versionToDelete} が正常に削除されました。`, 'python-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Python ${versionToDelete} の削除中にエラーが発生しました: ${error.message}`, 'python-log');
      throw error;
    }
  });
};

module.exports = {
  registerPythonHandlers
};
