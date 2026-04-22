import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectTools } from './tool-detector.js';

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `tool-detector-test-${Date.now()}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('Rails detection', () => {
  it('detects via Gemfile containing rails', () => {
    writeFileSync(join(root, 'Gemfile'), `gem "rails", "~> 7.1"`);
    const tools = detectTools(root);
    expect(tools.find(t => t.id === 'rails')).toBeDefined();
  });

  it('does not detect rails from a non-rails Gemfile', () => {
    writeFileSync(join(root, 'Gemfile'), `gem "sinatra"`);
    const tools = detectTools(root);
    expect(tools.find(t => t.id === 'rails')).toBeUndefined();
  });

  it('detects via config/application.rb with Rails::Application', () => {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, 'config/application.rb'), `class Application < Rails::Application\nend`);
    const tools = detectTools(root);
    expect(tools.find(t => t.id === 'rails')).toBeDefined();
  });

  it('detects via bin/rails existence alone', () => {
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(join(root, 'bin/rails'), '#!/usr/bin/env ruby');
    const tools = detectTools(root);
    expect(tools.find(t => t.id === 'rails')).toBeDefined();
  });
});
