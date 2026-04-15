/**
 * Unit tests for content extractor.
 * Uses hand-written fixtures in a temp directory to avoid depending on real code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractDirectoryContent } from './content-extractor.js';
import type { ScanEntry } from './scanner.js';

let fixtureRoot: string;

function makeEntry(name: string, content: string, repoRoot: string): ScanEntry {
  const fullPath = join(repoRoot, name);
  writeFileSync(fullPath, content, 'utf-8');
  return {
    path: fullPath,
    relativePath: name,
    name,
    isDirectory: false,
    children: [],
    depth: 1,
    extension: name.slice(name.lastIndexOf('.')),
    sizeBytes: statSync(fullPath).size,
  };
}

function makeRoot(children: ScanEntry[], repoRoot: string): ScanEntry {
  return {
    path: repoRoot,
    relativePath: '.',
    name: 'root',
    isDirectory: true,
    children,
    depth: 0,
    extension: null,
    sizeBytes: 0,
  };
}

beforeEach(() => {
  fixtureRoot = join(tmpdir(), `klonode-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(fixtureRoot, { recursive: true });
});

afterEach(() => {
  if (existsSync(fixtureRoot)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe('extractDirectoryContent — TypeScript', () => {
  it('extracts function exports with signatures', () => {
    const entry = makeEntry('utils.ts', `
export function add(a: number, b: number): number {
  return a + b;
}

export async function fetchUser(id: string): Promise<User> {
  return {} as User;
}

function privateHelper() {}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const fns = result.exports.filter(e => e.kind === 'function');
    expect(fns.map(f => f.name)).toContain('add');
    expect(fns.map(f => f.name)).toContain('fetchUser');
    expect(fns.map(f => f.name)).not.toContain('privateHelper');
  });

  it('extracts classes, interfaces, types, enums, const', () => {
    const entry = makeEntry('types.ts', `
export class User {
  constructor(public id: string) {}
}

export interface Config {
  token: string;
}

export type Status = 'ok' | 'error';

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export const API_URL = 'https://api.example.com';
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const names = new Set(result.exports.map(e => e.name));
    expect(names).toContain('User');
    expect(names).toContain('Config');
    expect(names).toContain('Status');
    expect(names).toContain('Role');
    expect(names).toContain('API_URL');
  });

  it('detects React component exports', () => {
    const entry = makeEntry('Button.tsx', `
export default function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click</button>;
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const components = result.exports.filter(e => e.kind === 'component');
    expect(components.map(c => c.name)).toContain('Button');
  });
});

describe('extractDirectoryContent — API routes', () => {
  it('extracts Next.js App Router route handlers', () => {
    const entry = makeEntry('route.ts', `
export async function GET(request: Request) {
  return Response.json({ hello: 'world' });
}

export async function POST(request: Request) {
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  return Response.json({ deleted: true });
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const methods = result.apiRoutes.map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
  });

  it('extracts SvelteKit RequestHandler routes', () => {
    const entry = makeEntry('+server.ts', `
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  return new Response('ok');
};

export const POST: RequestHandler = async ({ request }) => {
  return new Response('created');
};
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const methods = result.apiRoutes.map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });
});

describe('extractDirectoryContent — pattern detection', () => {
  it('detects NextAuth and admin patterns', () => {
    const entry = makeEntry('auth.ts', `
import NextAuth from 'next-auth';
import { getServerSession } from 'next-auth/next';

const ADMIN_EMAILS = ['admin@example.com'];

export async function requireAdmin() {
  const session = await getServerSession();
  if (!ADMIN_EMAILS.includes(session?.user?.email ?? '')) {
    throw new Error('Unauthorized');
  }
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    expect(result.patterns.some(p => /NextAuth/i.test(p))).toBe(true);
    expect(result.patterns.some(p => /admin/i.test(p) && /ADMIN_EMAILS/i.test(p))).toBe(true);
  });

  it('detects Prisma model usage', () => {
    const entry = makeEntry('db.ts', `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function getPosts() {
  return prisma.post.findMany();
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const prismaPattern = result.patterns.find(p => p.includes('Prisma models'));
    expect(prismaPattern).toBeTruthy();
    expect(prismaPattern).toContain('user');
    expect(prismaPattern).toContain('post');
  });
});

describe('extractDirectoryContent — Prisma schema', () => {
  it('extracts Prisma models and enums', () => {
    const entry = makeEntry('schema.prisma', `
generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
  role  Role   @default(USER)
  posts Post[]
}

model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}

enum Role {
  ADMIN
  USER
  GUEST
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const names = result.exports.map(e => e.name);
    expect(names).toContain('User');
    expect(names).toContain('Post');
    expect(names).toContain('Role');
    // Enum should be the enum kind
    expect(result.exports.find(e => e.name === 'Role')?.kind).toBe('enum');
  });
});

describe('extractDirectoryContent — Python', () => {
  it('extracts functions, classes, and constants', () => {
    const entry = makeEntry('service.py', `
"""User service module."""

API_VERSION = "1.0"
MAX_RETRIES: int = 3

def get_user(user_id: int):
    return None

async def fetch_user(user_id: int):
    pass

def _private_helper():
    pass

class UserService:
    def find(self, id):
        pass
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const names = result.exports.map(e => e.name);
    expect(names).toContain('get_user');
    expect(names).toContain('fetch_user');
    expect(names).toContain('UserService');
    expect(names).toContain('API_VERSION');
    expect(names).toContain('MAX_RETRIES');
    expect(names).not.toContain('_private_helper');
  });
});

describe('extractDirectoryContent — Java', () => {
  it('extracts public types and methods', () => {
    const entry = makeEntry('User.java', `
package com.example;

public class User {
    public static final int MAX_AGE = 120;

    public String getName() {
        return this.name;
    }

    public static User create(String name) {
        return new User();
    }
}

public interface Greeter {
    String greet(String name);
}

public enum Role {
    ADMIN, USER
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const byName = new Map(result.exports.map(e => [e.name, e.kind]));
    expect(byName.get('User')).toBe('class');
    expect(byName.get('Greeter')).toBe('interface');
    expect(byName.get('Role')).toBe('enum');
    expect(byName.get('getName')).toBe('function');
    expect(byName.get('create')).toBe('function');
    expect(byName.get('MAX_AGE')).toBe('const');
  });
});

describe('extractDirectoryContent — Ruby', () => {
  it('extracts modules, classes, and methods', () => {
    const entry = makeEntry('api.rb', `
module Api
  VERSION = "1.0"

  class Client
    def initialize(token)
      @token = token
    end

    def fetch(path)
    end

    def self.build(token)
      new(token)
    end
  end
end
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const names = result.exports.map(e => e.name);
    expect(names).toContain('Api');
    expect(names).toContain('Client');
    expect(names).toContain('initialize');
    expect(names).toContain('fetch');
    expect(names).toContain('build');
    expect(names).toContain('VERSION');
  });
});

describe('extractDirectoryContent — file purposes', () => {
  it('infers component purpose from React file', () => {
    const entry = makeEntry('Header.tsx', `
export default function Header({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const purpose = result.filePurposes.get('Header.tsx');
    expect(purpose).toBeTruthy();
    expect(purpose?.toLowerCase()).toContain('header');
  });

  it('infers types-only purpose', () => {
    const entry = makeEntry('types.ts', `
export interface User {
  id: string;
}

export type Status = 'ok' | 'error';
`, fixtureRoot);
    const result = extractDirectoryContent(makeRoot([entry], fixtureRoot), fixtureRoot);
    const purpose = result.filePurposes.get('types.ts');
    expect(purpose).toBeTruthy();
    expect(purpose?.toLowerCase()).toContain('types');
  });
});
