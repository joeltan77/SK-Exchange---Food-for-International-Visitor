/**
 * Visitor Session & Local Tracking Helper
 * Maintains a persistent, unique visitor ID per device in localStorage,
 * allowing visitors to see their own past orders across refreshes.
 */

const VISITOR_ID_KEY = 'kstreet_visitor_id';

export function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return 'visitor_anonymous';

  let vid = localStorage.getItem(VISITOR_ID_KEY);
  if (!vid) {
    vid = `v_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem(VISITOR_ID_KEY, vid);
  }
  return vid;
}
