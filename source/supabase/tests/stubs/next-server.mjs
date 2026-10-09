// Stand-in for `next/server`: the Web-standard pieces a route handler uses.
export class NextRequest extends Request {}

export class NextResponse extends Response {
  static json(body, init) {
    return Response.json(body, init)
  }
}

export function after(fn) {
  return fn()
}
