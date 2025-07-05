const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');

function getOSAndArchInfo(langType) {
    const os = process.platform;
    let arch = process.arch;
    let executableExt = '';
    let archiveExt = '.zip';
    let platformName = '';
    let jvmImpl = 'hotspot';

    switch (os) {
        case 'win32':
            executableExt = '.exe';
            archiveExt = '.zip';
            break;
        case 'darwin':
            archiveExt = '.tar.gz';
            break;
        case 'linux':
            archiveExt = '.tar.gz';
            break;
        default:
            throw new Error(`Unsupported operating system: ${os}`);
    }

    switch (langType) {
        case 'node':
            if (arch === 'ia32') arch = 'x86';
            platformName = os === 'win32' ? 'win' : os;
            break;
        case 'python':
            if (arch === 'x64') arch = 'amd64';
            if (arch === 'ia32') arch = 'win32';
            if (os === 'darwin') archiveExt = '.tgz';
            platformName = os === 'win32' ? 'windows' : os === 'darwin' ? 'macos' : os;
            break;
        case 'java':
            if (arch === 'arm64') arch = 'aarch64';
            if (arch === 'ia32') arch = 'x86';
            if (os === 'darwin') platformName = 'mac';
            else platformName = os;
            break;
        case 'go':
            if (arch === 'x64') arch = 'amd64';
            platformName = os === 'win32' ? 'windows' : os === 'darwin' ? 'darwin' : os;
            break;
        default:
            throw new Error(`Unknown language type: ${langType}`);
    }

    return { os, arch, executableExt, archiveExt, platformName, jvmImpl };
}

/**
 * アーカイブを解凍する
 * @param {string} archivePath
 * @param {string} destinationPath
 * @param {string} os
 * @param {string} langType
 * @param {function(string, string)} sendLog
 */
async function extractAndMoveArchive(archivePath, destinationPath, os, langType, sendLog) {
    const logChannel = `${langType}-log`;
    sendLog(`📤 アーカイブを解凍中: ${archivePath}`, logChannel);

    if (os === 'win32') {
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destinationPath, true);
    } else if (os === 'darwin' || os === 'linux') {
        try {
            await new Promise((resolve, reject) => {
                exec(`tar -xzf "${archivePath}" -C "${destinationPath}"`, (error, stdout, stderr) => {
                    if (error) {
                        sendLog(`❌ tarコマンドエラー: ${stderr || stdout}`, logChannel);
                        return reject(error);
                    }
                    if (stdout) sendLog(`ℹ️ tar stdout: ${stdout}`, logChannel);
                    if (stderr) sendLog(`⚠️ tar stderr: ${stderr}`, logChannel);
                    resolve();
                });
            });
        } catch (e) {
            sendLog(`❌ tarコマンド実行に失敗しました: ${e.message}`, logChannel);
            throw e;
        }
    } else {
        throw new Error(`Unsupported OS for archive extraction: ${os}`);
    }

    let extractedRootFolderName = '';
    const archiveBaseName = path.basename(archivePath, getOSAndArchInfo(langType).archiveExt).replace('.tar', '').replace('.tgz', '');

    switch (langType) {
        case 'node':
            extractedRootFolderName = archiveBaseName;
            break;
        case 'python':
            extractedRootFolderName = archiveBaseName.startsWith('python-') ? archiveBaseName : `Python-${archiveBaseName.replace('python-', '')}`;
            if (os === 'win32' && archivePath.endsWith('.exe')) {
            }
            break;
        case 'java':
            extractedRootFolderName = archiveBaseName;
            break;
        case 'go':
            extractedRootFolderName = 'go';
            break;
    }

    const sourcePathInArchive = path.join(destinationPath, extractedRootFolderName);
    const finalDestinationPath = path.join(destinationPath, path.basename(destinationPath));

    let actualExtractedPath = sourcePathInArchive;
    try {
        await fs.access(actualExtractedPath);
    } catch (e) {
        const entries = await fs.readdir(destinationPath, { withFileTypes: true });
        const firstDir = entries.find(dirent => dirent.isDirectory());
        if (firstDir) {
            actualExtractedPath = path.join(destinationPath, firstDir.name);
            sendLog(`ℹ️ 展開されたディレクトリ名が期待と異なりました。実際のパス: ${actualExtractedPath}`, logChannel);
        } else {
            throw new Error(`アーカイブから有効なディレクトリが見つかりませんでした。`);
        }
    }

    try {
        if (actualExtractedPath !== destinationPath) {
            const tempPath = actualExtractedPath + '_temp_rename';
            await fs.rename(actualExtractedPath, tempPath);

            try {
                await fs.rename(tempPath, destinationPath);
            } catch (renameError) {
                if (renameError.code === 'EPERM') {
                    sendLog(`⚠️ rename失敗。代わりにコピー＆削除を行います: ${renameError.message}`, logChannel);
                    await fsExtra.copy(tempPath, destinationPath);
                    await fsExtra.remove(tempPath);
                } else {
                    throw renameError;
                }
            }

            sendLog(`✅ バイナリを ${destinationPath} に配置しました。`, logChannel);
        } else {
            sendLog(`ℹ️ バイナリは既に配置されています。移動をスキップしました。`, logChannel);
        }
    } catch (e) {
        sendLog(`❌ 展開されたディレクトリの配置に失敗しました: ${e.message}`, logChannel);
        throw e;
    }
}

module.exports = {
    getOSAndArchInfo,
    extractAndMoveArchive
};
