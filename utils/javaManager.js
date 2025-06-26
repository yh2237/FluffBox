const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const JAVA_ROOT_DIR = path.join(app.getPath('userData'), 'java_versions');
const CURRENT_JAVA_SYMLINK_PATH = path.join(JAVA_ROOT_DIR, 'current');

/**
 * JavaがPATHからアクセス可能かチェックする関数
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<boolean>} Javaがアクセス可能かどうか
 */
const checkJavaAccessible = (sendLog) => {
  return new Promise((resolve) => {
    exec('java -version', async (error, stdout, stderr) => {
      if (!error && (stdout || stderr)) {
        sendLog(`ℹ️ 現在アクティブなJavaバージョン (システムPATHより):\n${stdout || stderr}`.trim(), 'java-log');
        resolve(true);
      } else {
        if (fs.existsSync(CURRENT_JAVA_SYMLINK_PATH)) {
          try {
            const targetPath = await fs.promises.readlink(CURRENT_JAVA_SYMLINK_PATH);
            const resolvedPath = path.resolve(path.dirname(CURRENT_JAVA_SYMLINK_PATH), targetPath);
            const activeVersionDirName = path.basename(resolvedPath);
            sendLog(`ℹ️ 現在アクティブなJavaバージョン: ${activeVersionDirName}\n(システムPATHへの反映にはターミナルの再起動が必要です)`, 'java-log');
            resolve(true);
          } catch (symlinkError) {
            sendLog(`ℹ️ シンボリックリンクの確認中にエラー: ${symlinkError.message}`, 'java-log');
            resolve(false);
          }
        } else {
          sendLog(`ℹ️ 現在のシステムPATHではJavaにアクセスできません。`, 'java-log');
          resolve(false);
        }
      }
    });
  });
};

/**
 * インストール済みJavaバージョンをリストする関数
 * @returns {Promise<string[]>} インストール済みJavaバージョン
 */
const getInstalledJavaVersions = async () => {
  if (!fs.existsSync(JAVA_ROOT_DIR)) {
    return [];
  }
  const directories = await fs.promises.readdir(JAVA_ROOT_DIR, { withFileTypes: true });
  return directories
    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('jdk-'))
    .map(dirent => dirent.name.replace('jdk-', ''));
};

/**
 * JavaのシンボリックリンクとPATHとJAVA_HOMEを更新するやつ
 * @param {string} targetVersionName - 切り替えるJavaのバージョン名
 * @param {function(string, string)} sendLog - ログを送信する関数
 * @returns {Promise<void>}
 */
const updateCurrentJavaSymlinkAndPath = async (targetVersionName, sendLog) => {
  const targetJavaDirName = `jdk-${targetVersionName}`;
  const targetJavaPath = path.join(JAVA_ROOT_DIR, targetJavaDirName);

  const javaExePath = path.join(targetJavaPath, 'bin', 'java.exe');

  if (!fs.existsSync(javaExePath)) {
    throw new Error(`${targetVersionName} のJava実行ファイルが見つかりません。インストールが不完全な可能性があります。`);
  }

  try {
    if (fs.existsSync(CURRENT_JAVA_SYMLINK_PATH)) {
      sendLog('🔗 既存のJavaシンボリックリンクを削除中...', 'java-log');
      await fs.promises.unlink(CURRENT_JAVA_SYMLINK_PATH);
    }

    sendLog(`🔗 Java ${targetVersionName} へのシンボリックリンクを作成中...`, 'java-log');
    await fs.promises.symlink(targetJavaPath, CURRENT_JAVA_SYMLINK_PATH, 'junction');
    sendLog('✅ Javaシンボリックリンクの作成が完了しました。', 'java-log');

    const javaHomeValue = CURRENT_JAVA_SYMLINK_PATH;
    await new Promise((resolve, reject) => {
      exec(`setx JAVA_HOME "${javaHomeValue}"`, { encoding: 'shiftjis' }, (err, stdout, stderr) => {
        if (err) {
          sendLog(`❌ JAVA_HOME 環境変数の設定に失敗しました: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`, 'java-log');
          reject(err);
        } else {
          if (stdout || stderr) {
            sendLog(`ℹ️ setx (JAVA_HOME) からのメッセージ:\nstdout: ${stdout}\nstderr: ${stderr}`, 'java-log');
          }
          sendLog('✅ JAVA_HOME 環境変数が更新されました。', 'java-log');
          resolve();
        }
      });
    });

    const currentPath = process.env.PATH || '';
    const newJavaPathEntry = path.join(CURRENT_JAVA_SYMLINK_PATH, 'bin');

    const pathParts = currentPath.split(path.delimiter).filter(p => {
      return !(p.toLowerCase().includes('java') || p.toLowerCase().includes('jdk') || p.toLowerCase().includes('jre')) &&
        !p.toLowerCase().includes(JAVA_ROOT_DIR.toLowerCase());
    });

    let updatedPath = [newJavaPathEntry, ...pathParts].join(path.delimiter);

    if (updatedPath.length > 1024) {
      sendLog('⚠️ PATH環境変数が非常に長くなっています。一部が切り詰められる可能性があります。', 'java-log');
    }

    sendLog(`PATH環境変数を更新中... (設定するPATH: ${updatedPath})`, 'java-log');

    await new Promise((resolve, reject) => {
      exec(`setx PATH "${updatedPath}"`, { encoding: 'shiftjis' }, (err, stdout, stderr) => {
        if (err) {
          sendLog(`❌ PATH環境変数の設定に失敗しました: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`, 'java-log');
          reject(err);
        } else {
          if (stdout || stderr) {
            sendLog(`ℹ️ setx (PATH for Java) からのメッセージ:\nstdout: ${stdout}\nstderr: ${stderr}`, 'java-log');
          }
          sendLog('✅ Java PATH環境変数が更新されました。', 'java-log');
          sendLog('ターミナルを再起動することをお勧めします。', 'java-log');
          resolve();
        }
      });
    });

  } catch (error) {
    sendLog(`❌ Javaバージョン切り替え/PATH更新中にエラーが発生しました: ${error.message}`, 'java-log');
    throw error;
  }
};

/**
 * Java関連のハンドラを登録する関数
 * @param {object} ipcMain - Electronのやつ
 * @param {function(string, string)} sendLog - ログを送信する関数
 */
const registerJavaHandlers = (ipcMain, sendLog) => {
  const fetchJsonFromUrl = (urlToFetch) => {
    return new Promise((resolve, reject) => {
      https.get(urlToFetch, (res) => {
        let rawData = '';
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          sendLog(`ℹ️ リダイレクト中: ${res.headers.location}`, 'java-log');
          const redirectUrl = new URL(res.headers.location, urlToFetch).href;
          fetchJsonFromUrl(redirectUrl).then(resolve).catch(reject);
          return;
        } else if (res.statusCode >= 400) {
          reject(new Error(`HTTPエラー ${res.statusCode}: ${res.statusMessage || ''}. URL: ${urlToFetch}`));
          return;
        }

        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(rawData);
            resolve(parsedData);
          } catch (e) {
            reject(new Error(`JSONパースエラー: ${e.message}. 受信データ: ${rawData.substring(0, 200)}...`));
          }
        });
      }).on('error', (err) => reject(err));
    });
  };

  // 利用可能なバージョンリストを取得するハンドラー
  ipcMain.handle('get-java-versions', async () => {
    let availableVersions = [];

    try {
      const infoUrl = 'https://api.adoptium.net/v3/info/available_releases';
      sendLog(`利用可能な主要リリース情報を取得中: ${infoUrl}`, 'java-log');
      const releaseInfo = await fetchJsonFromUrl(infoUrl);

      if (!releaseInfo || !releaseInfo.available_releases) {
        throw new Error("利用可能なリリース情報が取得できませんでした。");
      }

      const desiredLTSVersions = releaseInfo.available_releases.map(String);

      for (const majorVersion of desiredLTSVersions) {
        const assetsUrl = `https://api.adoptium.net/v3/assets/feature_releases/${majorVersion}/ga?vendor=eclipse&os=windows&arch=x64&image_type=jdk&heap_size=normal&referer=adoptopenjdk-api`;
        try {
          sendLog(`Java ${majorVersion} の最新GAリリース詳細情報を取得中: ${assetsUrl}`, 'java-log');
          const releases = await fetchJsonFromUrl(assetsUrl);

          if (releases && releases.length > 0) {
            const latestGaRelease = releases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
            if (latestGaRelease && latestGaRelease.release_name) {
              availableVersions.push(latestGaRelease.release_name);
            } else {
              sendLog(`⚠️ Java ${majorVersion} の最新GAリリースのリリース名が見つかりませんでした。`, 'java-log');
            }
          } else {
            sendLog(`⚠️ Java主要バージョン ${majorVersion} に合致するGAリリース情報が見つかりませんでした。`, 'java-log');
          }
        } catch (innerError) {
          sendLog(`❌ Java ${majorVersion} のリリース詳細情報取得に失敗しました: ${innerError.message}`, 'java-log');
        }
      }

      availableVersions.sort((a, b) => {
        const getMajor = (versionStr) => parseInt(versionStr.split('.')[0].replace('jdk-', ''));
        const getPatch = (versionStr) => {
          const match = versionStr.match(/\.(\d+)\+/);
          return match ? parseInt(match[1]) : 0;
        };
        const getBuild = (versionStr) => {
          const match = versionStr.match(/\+(\d+)/);
          return match ? parseInt(match[1]) : 0;
        };

        const majorA = getMajor(a);
        const majorB = getMajor(b);
        if (majorA !== majorB) return majorB - majorA;

        const patchA = getPatch(a);
        const patchB = getPatch(b);
        if (patchA !== patchB) return patchB - patchA;

        const buildA = getBuild(a);
        const buildB = getBuild(b);
        return buildB - buildA;
      });

    } catch (e) {
      console.error('Javaバージョン取得エラー:', e);
      sendLog(`❌ Javaバージョンリストの取得に失敗しました: ${e.message}`, 'java-log');
      throw new Error(`Javaバージョンリストの取得に失敗しました: ${e.message}`);
    }

    const installedVersions = await getInstalledJavaVersions();
    await checkJavaAccessible(sendLog);

    return { available: availableVersions, installed: installedVersions };
  });

  // Javaをダウンロードして解凍するハンドラー
  ipcMain.handle('install-java-version', async (event, selectedReleaseName) => {
    sendLog(`⚙️ Java ${selectedReleaseName} のインストールを開始します...`, 'java-log');

    const majorVersion = selectedReleaseName.split('.')[0].replace('jdk-', '');
    const arch = process.arch === 'x64' ? 'x64' : (process.arch === 'arm64' ? 'aarch64' : 'x64'); // Adoptium uses aarch64 for ARM
    let downloadUrl = '';

    try {
      const apiUrl = `https://api.adoptium.net/v3/assets/feature_releases/${majorVersion}/ga?vendor=eclipse&os=windows&arch=x64&image_type=jdk&heap_size=normal&referer=adoptopenjdk-api`;
      sendLog(`Java ${selectedReleaseName} の詳細情報を取得中: ${apiUrl}`, 'java-log');
      const releases = await fetchJsonFromUrl(apiUrl); // fetchJsonFromUrl でJSONを取得

      if (!releases || releases.length === 0) {
        throw new Error(`Java ${majorVersion} のリリース情報が見つかりませんでした。`);
      }

      const targetRelease = releases.find(r => r.release_name === selectedReleaseName);

      if (!targetRelease || !targetRelease.binaries || targetRelease.binaries.length === 0) {
        throw new Error(`指定されたリリース名 ${selectedReleaseName} のバイナリ情報が見つかりませんでした。`);
      }

      const packageBinary = targetRelease.binaries.find(b =>
        b.os === 'windows' &&
        b.architecture === arch &&
        b.image_type === 'jdk' &&
        b.package && b.package.link && b.package.name.endsWith('.zip')
      );

      if (!packageBinary || !packageBinary.package.link) {
        throw new Error(`Java ${selectedReleaseName} のZIPダウンロードリンクが見つかりませんでした。`);
      }
      downloadUrl = packageBinary.package.link;

    } catch (e) {
      sendLog(`❌ Java ${selectedReleaseName} のダウンロードURL取得に失敗しました: ${e.message}`, 'java-log');
      throw e;
    }

    if (!downloadUrl) {
      throw new Error(`Java ${selectedReleaseName} のダウンロードURLを特定できませんでした。`);
    }

    const versionDirName = `jdk-${selectedReleaseName}`;
    const installPath = path.join(JAVA_ROOT_DIR, versionDirName);

    if (fs.existsSync(installPath)) {
      sendLog(`⚠️ Java ${selectedReleaseName} は既にインストールされてます。`, 'java-log');
      sendLog('既にインストールされているバージョンに切り替える場合は、「バージョンを切り替える」ボタンを使用してください。', 'java-log');
      return 'already_managed';
    }

    const tempDownloadPath = path.join(app.getPath('temp'), `java-${selectedReleaseName}.zip`);

    try {
      if (!fs.existsSync(JAVA_ROOT_DIR)) {
        await fs.promises.mkdir(JAVA_ROOT_DIR, { recursive: true });
      }

      sendLog(`${selectedReleaseName} をダウンロード中: ${downloadUrl}`, 'java-log');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempDownloadPath);
        https.get(downloadUrl, (res) => {

          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, downloadUrl).href;
            sendLog(`ℹ️ ダウンロードのリダイレクトを追跡中: ${redirectUrl}`, 'java-log');
            https.get(redirectUrl, (redirectRes) => {
              if (redirectRes.statusCode !== 200) {
                file.destroy();
                return reject(new Error(`リダイレクト後にダウンロード失敗。HTTPステータス: ${redirectRes.statusCode}. URL: ${redirectUrl}`));
              }
              redirectRes.pipe(file);
              file.on('finish', () => { file.close(() => resolve()); });
              redirectRes.on('error', (err) => {
                fs.unlink(tempDownloadPath, (unlinkErr) => { if (unlinkErr) console.error('リダイレクトエラー後の一時ファイルの削除に失敗しました:', unlinkErr); });
                reject(err);
              });
            }).on('error', (err) => {
              fs.unlink(tempDownloadPath, (unlinkErr) => { if (unlinkErr) console.error('リダイレクト初回エラー後の一時ファイルの削除に失敗しました:', unlinkErr); });
              reject(err);
            });
            return;
          } else if (res.statusCode !== 200) {
            file.destroy();
            return reject(new Error(`ダウンロード失敗。HTTPステータス: ${res.statusCode}. URL: ${downloadUrl}`));
          }
          res.pipe(file);
          file.on('finish', () => { file.close(() => resolve()); });
        }).on('error', (err) => {
          fs.unlink(tempDownloadPath, (unlinkErr) => {
            if (unlinkErr) console.error('一時ファイルの削除に失敗しました:', unlinkErr);
            reject(err);
          });
        });
      });
      sendLog('✅ ダウンロード完了。', 'java-log');

      sendLog(`📦 ${selectedReleaseName} を解凍中...`, 'java-log');
      const zip = new AdmZip(tempDownloadPath);

      const zipEntries = zip.getEntries();
      const rootDirInZip = zipEntries.find(entry => entry.isDirectory && entry.entryName.endsWith('/') && entry.entryName.split('/').length === 2)?.entryName.split('/')[0];

      if (!rootDirInZip) {
        throw new Error("ZIPファイル内にルートディレクトリが見つかりませんでした。");
      }

      zip.extractAllTo(JAVA_ROOT_DIR, true);

      const extractedPath = path.join(JAVA_ROOT_DIR, rootDirInZip);
      await fs.promises.rename(extractedPath, installPath);
      sendLog(`✅ ${selectedReleaseName} の解凍と配置が完了しました: ${installPath}`, 'java-log');

      await updateCurrentJavaSymlinkAndPath(selectedReleaseName, sendLog);

      sendLog(`Java ${selectedReleaseName} のインストールとセットアップが完了しました！`, 'java-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Javaインストール中にエラーが発生しました: ${error.message}`, 'java-log');
      throw error;
    } finally {
      if (fs.existsSync(tempDownloadPath)) {
        fs.unlink(tempDownloadPath, (err) => {
          if (err) console.error('一時ファイルの削除に失敗しました:', err);
        });
      }
    }
  });

  // 指定されたバージョンに切り替えるハンドラー
  ipcMain.handle('switch-java-version', async (event, targetVersion) => {
    sendLog(`Java ${targetVersion} への切り替えを開始します...`, 'java-log');
    const targetJavaDirName = `jdk-${targetVersion}`;
    const installPath = path.join(JAVA_ROOT_DIR, targetJavaDirName);

    if (!fs.existsSync(installPath)) {
      sendLog(`❌ ${targetVersion} はインストールされていません。まずインストールしてください。`, 'java-log');
      throw new Error('指定されたJavaバージョンはインストールされていません。');
    }

    try {
      await updateCurrentJavaSymlinkAndPath(targetVersion, sendLog);
      sendLog(`✅ Java ${targetVersion} への切り替えが完了しました。`, 'java-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Javaバージョン切り替え中にエラーが発生しました: ${error.message}`, 'java-log');
      throw error;
    }
  });

  // 指定されたバージョンを削除するハンドラー
  ipcMain.handle('delete-java-version', async (event, versionToDelete) => {
    sendLog(`⚙️ Java ${versionToDelete} の削除を開始します...`, 'java-log');
    const targetJavaDirName = `jdk-${versionToDelete}`;
    const versionPath = path.join(JAVA_ROOT_DIR, targetJavaDirName);

    if (!fs.existsSync(versionPath)) {
      sendLog(`❌ Java ${versionToDelete} が見つかりませんでした。`, 'java-log');
      throw new Error('指定されたJavaバージョンは存在しません。');
    }

    if (fs.existsSync(CURRENT_JAVA_SYMLINK_PATH)) {
      try {
        const activeTargetPath = await fs.promises.readlink(CURRENT_JAVA_SYMLINK_PATH);
        const resolvedActivePath = path.resolve(path.dirname(CURRENT_JAVA_SYMLINK_PATH), activeTargetPath);
        if (resolvedActivePath === versionPath) {
          sendLog(`⚠️ Java ${versionToDelete} は現在アクティブなバージョンです。削除する前に別のバージョンに切り替えてください。`, 'java-log');
          throw new Error('アクティブなバージョンは削除できません。');
        }
      } catch (symlinkError) {
        sendLog(`シンボリックリンクの確認中にエラーが発生しました: ${symlinkError.message}`, 'java-log');
      }
    }

    try {
      sendLog(`🗑️ ${versionPath} を削除中...`, 'java-log');
      await fs.promises.rm(versionPath, { recursive: true, force: true });
      sendLog(`✅ Java ${versionToDelete} が正常に削除されました。`, 'java-log');
      return 'done';
    } catch (error) {
      sendLog(`❌ Java ${versionToDelete} の削除中にエラーが発生しました: ${error.message}`, 'java-log');
      throw error;
    }
  });
};

module.exports = {
  registerJavaHandlers
};
