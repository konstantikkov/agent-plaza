/**
 * Build-time configuration (kept in one place so tests can substitute it).
 * VITE_PLAZA_WS_URL points the client at a standalone WebSocket server when
 * the static site is hosted elsewhere; unset means same-origin /api/plaza.
 */
export const PLAZA_WS_URL: string | undefined = (import.meta.env as Record<string, string | undefined>)
  .VITE_PLAZA_WS_URL;
