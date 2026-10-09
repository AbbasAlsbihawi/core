// The CSP of a document is fixed when the HTML response arrives, but every RSC request (client
// navigation, router.refresh) renders with that request's fresh nonce. An element React creates or
// updates in the browser must carry the nonce of the *document*, or the browser blocks it.
// Next's own <script nonce> tags from the HTML response keep it: the `nonce` IDL property stays
// readable after the browser hides the attribute.

/** The nonce of the current document's CSP; undefined on the server. */
export function documentNonce(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  return nonce === '' ? undefined : nonce; // '' = no CSP nonce on this document
}
