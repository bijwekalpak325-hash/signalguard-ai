import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getStore, updateStore } from './local-store';

const SESSION_COOKIE_NAME = 'signalguard_session';
const SESSION_EXPIRY_HOURS = 24;
const DEMO_EMAIL = 'admin@signalguard.local';
const DEMO_PASSWORD = 'SignalGuard@2026';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

const demoUser: AuthUser = {
  id: 1,
  email: DEMO_EMAIL,
  name: 'System Administrator',
  role: 'admin',
};


export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000;

  await updateStore((store) => {
    store.authSessions = store.authSessions.filter((session) => session.expiresAt > Date.now());
    store.authSessions.push({ token, userId, expiresAt });
  });

  return token;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_EXPIRY_HOURS);

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME);
  return token?.value || null;
}

export async function validateSession(token: string) {
  const store = await getStore();
  const session = store.authSessions.find((item) => item.token === token);
  if (!session || session.expiresAt <= Date.now()) {
    await updateStore((current) => {
      current.authSessions = current.authSessions.filter((item) => item.token !== token);
    });
    return null;
  }

  return session.userId === demoUser.id ? demoUser : null;
}

export async function getCurrentUser() {
  const token = await getSessionToken();
  if (!token) {
    return null;
  }

  return validateSession(token);
}

export async function destroySession(token: string) {
  await updateStore((store) => {
    store.authSessions = store.authSessions.filter((session) => session.token !== token);
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function initDemoUser() {
  return demoUser;
}

export function authenticateDemoUser(email: string, password: string): AuthUser | null {
  if (email.toLowerCase().trim() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
    return null;
  }

  return demoUser;
}
