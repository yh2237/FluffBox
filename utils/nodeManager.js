const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const NODE_ROOT_DIR = path.join(app.getPath('userData'), 'nodejs_versions');
const CURRENT_NODE_SYMLINK_PATH = path.join(NODE_ROOT_DIR, 'current');

/**
 * Node.jsがPATHからアクセス可能かチェックする関数
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<boolean>} Node.jsがアクセス可能かどうか
 */
const checkNodeAccessible = (sendLog) => {
  return new Promise((resolve) => {
    exec('node -V', async (error, stdout, stderr) => {
      if (!error && !stderr) {
        sendLog(`ℹ️ 現在アクティブなNode.jsバージョン (システムPATHより): ${stdout.trim()}`, 'node-log');
        resolve(true);
      } else {
        if (fs.existsSync(CURRENT_NODE_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.promises.readlink(CURRENT_NODE_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_NODE_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(resolvedPath);
            sendLog(`ℹ️ 現在アクティブなNode.jsバージョン: ${activeVersionDirName}\n(システムPATHへの反映にはターミナルの再起動が必要です)`, 'node-log');
            resolve(true);
          } catch (symlinkError) {
            sendLog(`ℹ️ シンボリックリンクの確認中にエラー: ${symlinkError.message})`, 'node-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ 現在のシステムPATHではNode.jsにアクセスできません。`, 'node-log');
          resolve(false);
        }
      }
    });
  });
};

/**
 * インストール済みNode.jsバージョンをリストする関数
 * @returns {Promise<string[]>} インストール済みNode.jsバージョンの配列
 */
const getInstalledNodeVersions = async () => {
  if (!fs.existsSync(NODE_ROOT_DIR)) {
    return [];
  }
  const directories = await fs.promises.readdir(NODE_ROOT_DIR, { withFileTypes: true });
  return directories
    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('v'))
    .map(dirent => dirent.name);
};

/**
 * Node.jsのシンボリックリンクとPATHを更新する関数
 * @param {string} targetVersionName - 切り替えるNode.jsのバージョン名
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<void>}
 */
const updateCurrentNodeSymlinkAndPath = async (targetVersionName, sendLog) => {
  const targetVersionPath = path.join(NODE_ROOT_DIR, targetVersionName);
  const nodeExePath = path.join(targetVersionPath, 'node.exe');

  if (!fs.existsSync(nodeExePath)) {
    throw new Error(`${targetVersionName} のNode.js実行ファイルが見つかりません。インストールが不完全な可能性があります。`);
  }

  try {
    if (fs.existsSync(CURRENT_NODE_SYMLINK_PATH)) {
      sendLog('🔗 既存のNode.jsシンボリックリンクを削除中...', 'node-log');
      await fs.promises.unlink(CURRENT_NODE_SYMLINK_PATH);
    }

    sendLog(`🔗 ${targetVersionName} へのNode.jsシンボリックリンクを作成中...`, 'node-log');
    await fs.promises.symlink(targetVersionPath, CURRENT_NODE_SYMLINK_PATH, 'junction');
    sendLog('✅ Node.jsシンボリックリンクの作成が完了しました。', 'node-log');

    const currentPath = process.env.PATH || '';
    const newNodePathEntry = CURRENT_NODE_SYMLINK_PATH;

    const pathParts = currentPath.split(path.delimiter).filter(p => {
      return !p.toLowerCase().includes('nodejs') && !p.toLowerCase().includes(NODE_ROOT_DIR.toLowerCase());
    });

    let updatedPath = [newNodePathEntry, ...pathParts].join(path.delimiter);

    if (updatedPath.length > 1024) {
      sendLog('⚠️ PATH環境変数が非常に長くなっています。一部が切り詰められる可能性があります。', 'node-log');
    }

    sendLog(`Node.js PATH環境変数を更新中... (設定するPATH: ${updatedPath})`, 'node-log');

    await new Promise((resolve, reject) => {
      exec(`setx PATH "${updatedPath}"`, { encoding: 'shiftjis' }, (err, stdout, stderr) => {
        if (err) {
          sendLog(`❌ Node.js PATH環境変数の設定に失敗しました: ${err.message}\n` +
            `stdout: ${stdout}\nstderr: ${stderr}`, 'node-log');
          reject(err);
        } else {
          if (stdout || stderr) {
            sendLog(`ℹ️ setx (Node.js) からのメッセージ:\nstdout: ${stdout}\nstderr: ${stderr}`, 'node-log');
          }
          sendLog('✅ Node.js PATH環境変数が更新されました。', 'node-log');
          sendLog('ターミナルを再起動することをお勧めします。', 'node-log');
          resolve();
        }
      });
    });

  } catch (error) {
    sendLog(`❌ Node.jsバージョン切り替え/PATH更新中にエラーが発生しました: ${error.message}`, 'node-log');
    throw error;
  }
};

/**
 * Node.js関連のIPCハンドラを登録する関数
 * @param {object} ipcMain - Electronのやつ
 * @param {function(string, string)} sendLog - ログを送信する関数
 */
const registerNodeHandlers = (ipcMain, sendLog) => {
  ipcMain.handle('get-node-versions', async () => {
    try {
      const url = 'https://nodejs.org/dist/index.json';
      const data = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(rawData);
            } else {
              reject(new Error(`HTTPエラー ${res.statusCode}: ${rawData}`));
            }
          });
        }).on('error', (err) => reject(err));
      });

      const allReleases = JSON.parse(data);
      const versions = allReleases
        .filter(release => !release.version.includes('rc') && !release.version.includes('nightly'))
        .map(release => release.version)
        .slice(0, 50);

      const installedVersions = await getInstalledNodeVersions();
      await checkNodeAccessible(sendLog);

      return { available: versions, installed: installedVersions };
    } catch (e) {
      console.error('Node.jsバージョンリストの取得/解析エラー:', e);
      sendLog(`❌ Node.jsバージョン情報の取得に失敗しました: ${e.message}`, 'node-log');
      throw new Error(`Node.jsバージョン情報の取得に失敗しました: ${e.message}`);
    }
  });

  // Node.jsをダウンロードして解凍するハンドラー
  ipcMain.handle('install-node-version', async (event, selectedVersion) => {
    sendLog(`⚙️ Node.js ${selectedVersion} のインストールを開始します...`, 'node-log');

    const versionDirName = selectedVersion;
    const installPath = path.join(NODE_ROOT_DIR, versionDirName);

    if (fs.existsSync(installPath)) {
      sendLog(`⚠️ Node.js ${selectedVersion} は既にインストールされています。`, 'node-log');
      sendLog('既にインストールされているバージョンに切り替える場合は、「バージョンを切り替える」ボタンを使用してください。', 'node-log');
      return 'already_managed';
    }

    const url = `https://nodejs.org/dist/${selectedVersion}/node-${selectedVersion}-win-x64.zip`;
    const tempDownloadPath = path.join(app.getPath('temp'), `node-${selectedVersion}-win-x64.zip`);

    try {
      if (!fs.existsSync(NODE_ROOT_DIR)) {
        await fs.promises.mkdir(NODE_ROOT_DIR, { recursive: true });
      }

      sendLog(`${selectedVersion} をダウンロード中: ${url}`, 'node-log');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempDownloadPath);
        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            file.destroy();
            return reject(new Error(`ダウンロード失敗。HTTPステータス: ${res.statusCode}. URLを確認してください: ${url}`));
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => resolve());
          });
        }).on('error', (err) => {
          fs.unlink(tempDownloadPath, () => reject(err));
        });
      });
      sendLog('✅ ダウンロード完了。', 'node-log');

      sendLog(`📦 ${selectedVersion} を解凍中...`, 'node-log');
      const zip = new AdmZip(tempDownloadPath);
      const zipEntries = zip.getEntries();
      const rootDirInZip = zipEntries[0].entryName.split('/')[0];

      zip.extractAllTo(NODE_ROOT_DIR, true);

      const extractedPath = path.join(NODE_ROOT_DIR, rootDirInZip);
      await fs.promises.rename(extractedPath, installPath);
      sendLog(`✅ ${selectedVersion} の解凍と配置が完了しました: ${installPath}`, 'node-log');

      await updateCurrentNodeSymlinkAndPath(versionDirName, sendLog);

      sendLog(`✅ Node.js ${selectedVersion} のインストールとセットアップが完了しました。`, 'node-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Node.jsインストール中にエラーが発生しました: ${error.message}`, 'node-log');
      throw error;
    } finally {
      if (fs.existsSync(tempDownloadPath)) {
        fs.unlink(tempDownloadPath, (err) => {
          if (err) console.error('Node.js一時ファイルの削除に失敗しました:', err);
        });
      }
    }
  });

  // 指定されたバージョンに切り替えるハンドラー
  ipcMain.handle('switch-node-version', async (event, targetVersion) => {
    sendLog(`⚙️ Node.js ${targetVersion} への切り替えを開始します...`, 'node-log');
    const versionDirName = targetVersion;
    const installPath = path.join(NODE_ROOT_DIR, versionDirName);

    if (!fs.existsSync(installPath)) {
      sendLog(`❌ ${targetVersion} はインストールされていません。まずインストールしてください。`, 'node-log');
      throw new Error('指定されたNode.jsバージョンはインストールされていません。');
    }

    try {
      await updateCurrentNodeSymlinkAndPath(versionDirName, sendLog);
      sendLog(`✅ Node.js ${targetVersion} への切り替えが完了しました。`, 'node-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Node.jsバージョン切り替え中にエラーが発生しました: ${error.message}`, 'node-log');
      throw error;
    }
  });

  // 指定されたバージョンを削除するハンドラー
  ipcMain.handle('delete-node-version', async (event, versionToDelete) => {
    sendLog(`⚙️ Node.js ${versionToDelete} の削除を開始します...`, 'node-log');
    const versionPath = path.join(NODE_ROOT_DIR, versionToDelete);

    if (!fs.existsSync(versionPath)) {
      sendLog(`❌ Node.js ${versionToDelete} は見つかりませんでした。`, 'node-log');
      throw new Error('指定されたNode.jsバージョンは存在しません。');
    }

    if (fs.existsSync(CURRENT_NODE_SYMLINK_PATH)) {
      try {
        const activeTargetPath = await fs.promises.readlink(CURRENT_NODE_SYMLINK_PATH);
        const resolvedActivePath = path.resolve(path.dirname(CURRENT_NODE_SYMLINK_PATH), activeTargetPath);
        if (resolvedActivePath === versionPath) {
          sendLog(`⚠️ Node.js ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'node-log');
          throw new Error('アクティブなバージョンは削除できません。');
        }
      } catch (symlinkError) {
        sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'node-log');
      }
    }

    try {
      sendLog(`🗑️ ${versionPath} を削除中...`, 'node-log');
      await fs.promises.rm(versionPath, { recursive: true, force: true });
      sendLog(`✅ Node.js ${versionToDelete} が正常に削除されました。`, 'node-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Node.js ${versionToDelete} の削除中にエラーが発生しました: ${error.message}`, 'node-log');
      throw error;
    }
  });
};

module.exports = {
  registerNodeHandlers
};
