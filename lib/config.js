import { readFileSync } from 'fs';
import { join } from 'path';

let _config = null;

export function getConfig() {
  if (!_config) {
    // process.cwd() is always the project root in Next.js API routes
    const configPath = join(process.cwd(), 'config.json');
    _config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return _config;
}
