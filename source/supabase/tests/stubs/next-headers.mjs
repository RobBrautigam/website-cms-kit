// Stand-in for `next/headers`.
export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} }
}
export async function cookies() {
  return { get: () => undefined, getAll: () => [], set() {} }
}
export async function headers() {
  return new Headers()
}
