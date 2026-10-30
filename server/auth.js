import crypto from 'node:crypto';
import { newId } from './db.js';
import { CAN } from './constants.js';

const SESSION_DAYS = 14;
export const COOKIE = 'jcs_sessie';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function createUser(db, { name, email, role, password }) {
  const id = newId();
  db.prepare('INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(id, name.trim(), email.trim(), role, hashPassword(password));
  return id;
}

function readCookie(req, name) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    if (token) {
      const row = db.prepare(`
        SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?`).get(token, new Date().toISOString());
      if (row) {
        req.user = { ...row };
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log eerst in.' });
  next();
}

export const can = (user, permission) => Boolean(user && CAN[permission].includes(user.role));

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: 'Je hebt geen rechten voor deze actie.' });
    }
    next();
  };
}

export function setSessionCookie(res, { token, expires }, secure) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, expires: new Date(expires), path: '/' });
}
