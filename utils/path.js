const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * ユーザーPATHにパスを追加する
 * @param {string} pathToAdd
 */
function addUserPath(pathToAdd) {
    const platform = os.platform();

    if (platform === "win32") {
        addPathWindows(pathToAdd);
    } else {
        addPathUnix(pathToAdd);
    }
}

function addPathWindows(pathToAdd) {
    try {
        const currentPath = execSync("powershell -command \"[Environment]::GetEnvironmentVariable('Path', 'User')\"", {
            encoding: "utf-8"
        }).trim();

        if (currentPath.includes(pathToAdd)) {
            console.log("すでにPATHに含まれています。");
            return;
        }

        const updatedPath = `${currentPath};${pathToAdd}`;
        execSync(`powershell -command "[Environment]::SetEnvironmentVariable('Path', '${updatedPath}', 'User')"`);
        console.log("ユーザーPATHに追加しました。");
    } catch (error) {
        console.error("PATH登録エラー:", error.message);
    }
}

function addPathUnix(pathToAdd) {
    const shell = process.env.SHELL || "";
    const home = os.homedir();
    let profileFile = "";

    if (shell.includes("bash")) {
        profileFile = path.join(home, ".bashrc");
    } else if (shell.includes("zsh")) {
        profileFile = path.join(home, ".zshrc");
    } else {
        profileFile = path.join(home, ".profile");
    }

    try {
        const exportLine = `export PATH="$PATH:${pathToAdd}"`;
        const content = fs.existsSync(profileFile) ? fs.readFileSync(profileFile, "utf-8") : "";
        if (content.includes(exportLine)) {
            console.log("すでにPATHに含まれています。");
            return;
        }

        fs.appendFileSync(profileFile, `\n# Added by path.js\n${exportLine}\n`);
        console.log(`${profileFile} にPATHを追加しました。`);
    } catch (err) {
        console.error("PATH登録エラー:", err.message);
    }
}

module.exports = { addUserPath };