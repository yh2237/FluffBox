<table>
  <tr>
    <td>
      <img src="https://github.com/user-attachments/assets/aa1b8801-b5e9-418a-bd7c-57336bb9dca1" alt="FluffBox Icon" width="128">
    </td>
    <td>
      <h1>FluffBox - (pre-release)</h1>
      <p>GUI software for easy installation, versioning, and uninstall of various runtime environments</p>
    </td>
  </tr>
</table>

🌐 Language: [🇺🇸 English](./README.md) | [🇯🇵 日本語](docs/README_ja.md)

---

## 🌟 Overview.

**FluffBox** is software that allows you to easily install, switch, and remove multiple programming runtime environments.
It is a simple GUI application especially for beginners and those who find it troublesome to build environments.

### 🎛 Supported runtime environments (more to be added)

- Node.js
- Python
- Java

---

## 🚧 Planned future features (under development)

~~Automatic installation of a specified execution environment and version by reading a profile~~
This feature is not implemented yet, but in the future we plan to enable batch automation of environment building by reading configuration files such as the following.

<details> 
<summary>📄 Example: profile file (planned)</summary>

```json
{
  "node": "18.16.0",
  "python": "3.11.5",
  "java": "17"
}
```
</details>

---

## 📦 Installation Instructions

🔗[Latest Version (v1.0.0)](https://github.com/yh2237/FluffBox/releases/tag/v1.0.0)

---

## 🚀 How to use

### No technical knowledge required!

However, be careful if the same runtime environments are already installed in your system.

✅ **Actions to take in case of trouble**.

If you already have an environment installed on your system, FluffBox may not work properly.

- The following actions will solve the problem:
  - Delete the PATH set in the existing environment.
  - Uninstall the relevant execution environment.

⚙️ **Other configuration features**

- Change the display language from **File** → **Settings**.
- Delete specific or all runtime environments from **File** → **Delete Execution Environment**.

---

## 📜 License

This software is licensed under the [MIT License](./LICENSE).
