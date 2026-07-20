import {EmptyExec, Errors, Option} from "@opendaw/lib-std"
import {RuntimeNotifier} from "@opendaw/lib-std"

const SESSION_KEY = "openmaw_mus_session"
const MUS_API_URL = import.meta.env.VITE_MUS_API_URL || "http://localhost:3000"

interface MusSession {
  token: string
  userId: string
  exp: number
  returnUrl?: string
  trackId?: string
  trackTitle?: string
  audioUrl?: string
}

/**
 * Resolve, verify, and cache a MŪS session from the URL query string.
 *
 * On boot, call resolveSession() once. It will:
 *  1. Look for ?session=<JWT> in the current URL
 *  2. POST /api/openmaw/verify to MŪS to validate the token
 *  3. Store the validated session in sessionStorage
 *  4. Strip the ?session param from the URL (replaceState)
 */
export class MusSessionService {
  #session: Option<MusSession> = Option.None
  #verified = false

  /**
   * Attempt to resolve a session from URL params or sessionStorage.
   */
  async resolve(): Promise<MusSession | null> {
    // 1. Try URL param first (fresh handoff from MŪS)
    const url = new URL(window.location.href)
    const urlToken = url.searchParams.get("session")
    const returnUrl = url.searchParams.get("return") || undefined
    const trackId = url.searchParams.get("trackId") || undefined
    const trackTitle = url.searchParams.get("trackTitle") || undefined
    const audioUrl = url.searchParams.get("audioUrl") || undefined

    if (urlToken) {
      const verified = await this.#verifyWithMus(urlToken)
      if (verified) {
        this.#persist(verified, returnUrl, trackId, trackTitle, audioUrl)
        this.#stripSessionFromUrl(url)
        return {...verified, returnUrl, trackId, trackTitle, audioUrl}
      }
    }

    // 2. Fall back to sessionStorage
    const cached = this.#fromStorage()
    if (cached && cached.exp > Date.now() / 1000) {
      this.#session = Option.wrap(cached)
      return cached
    }

    // 3. Nothing valid found — clean up stale storage
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }

  /**
   * Return the current valid session, or None.
   */
  getSession(): Option<MusSession> {
    return this.#session
  }

  /**
   * Return a Bearer Authorization header if a session exists.
   */
  authHeader(): Record<string, string> {
    return this.#session.map(s => ({ Authorization: `Bearer ${s.token}` })).unwrapOr({})
  }

  /**
   * Clear the session (e.g. on logout).
   */
  clear(): void {
    this.#session = Option.None
    sessionStorage.removeItem(SESSION_KEY)
  }

  // ── Private ────────────────────────────────────────────────

  async #verifyWithMus(token: string): Promise<MusSession | null> {
    try {
      const res = await fetch(`${MUS_API_URL}/api/openmaw/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })

      if (!res.ok) {
        console.warn("[MusSession] Verification failed:", res.status, await res.text())
        return null
      }

      const data = await res.json()
      if (!data.valid || !data.userId) return null

      return {
        token,
        userId: data.userId,
        exp: data.exp || Math.floor(Date.now() / 1000) + 300,
        returnUrl: data.returnUrl,
      }
    } catch (err) {
      console.error("[MusSession] Network error during verify:", err)
      return null
    }
  }

  #persist(session: MusSession, returnUrl?: string, trackId?: string, trackTitle?: string, audioUrl?: string): void {
    const payload: MusSession = { ...session, returnUrl, trackId, trackTitle, audioUrl }
    this.#session = Option.wrap(payload)
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload))
    } catch {
      // sessionStorage might be blocked in Private Browsing
    }
  }

  #fromStorage(): MusSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return null
      return JSON.parse(raw) as MusSession
    } catch {
      return null
    }
  }

  #stripSessionFromUrl(url: URL): void {
    url.searchParams.delete("session")
    url.searchParams.delete("return")
    window.history.replaceState({}, document.title, url.toString())
  }
}

export const musSessionService = new MusSessionService()
