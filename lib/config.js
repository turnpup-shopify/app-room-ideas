import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

let _config = null;

const CONFIG_PATH = join(process.cwd(), 'config.json');

export function getConfig() {
  if (!_config) {
    _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return _config;
}

/**
 * Merge updates into config.json and reset the singleton so
 * the next getConfig() call picks up the new values.
 */
export function saveConfig(updates) {
  const merged = { ...getConfig(), ...updates };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  _config = merged;
  return merged;
}
