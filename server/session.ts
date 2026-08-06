import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";

declare module "express-session" {
  interface SessionData {
    ownerId?: string;
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Signed anonymous session middleware. Each visitor gets a session cookie;
 * an `ownerId` is stamped into the session the first time they create a job
 * (or use the AI assistant) and is used to scope job access.
 */
export function buildSessionMiddleware(options?: { memoryStore?: boolean }): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be set to run the server");
  }

  let store: session.Store | undefined;
  if (!options?.memoryStore) {
    const PgStore = connectPgSimple(session);
    store = new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "user_sessions",
      createTableIfMissing: true,
    });
  }

  return session({
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    name: "bswmm.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: THIRTY_DAYS_MS,
    },
  });
}
