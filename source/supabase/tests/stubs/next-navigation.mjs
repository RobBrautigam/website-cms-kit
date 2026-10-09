// Stand-in for `next/navigation`.
export function redirect(path) {
  throw new Error(`redirect:${path}`)
}
