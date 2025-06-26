const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { app } = require('electron');

const configDir = path.join(app.getPath('userData'), 'config');
const configPath = path.join(configDir, 'config.yml');

let config = {};

function loadConfig() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(raw) || {};
  } else {
    config = {};
    save();
  }
  return config;
}

function get(key) {
  return config[key];
}

function set(key, value) {
  config[key] = value;
}

function save() {
  fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
}

function overwrite(newConfig = {}) {
  config = newConfig;
  save();
}

function current() {
  return config;
}

module.exports = {
  loadConfig,
  get,
  set,
  save,
  overwrite,
  current,
  configPath
};
