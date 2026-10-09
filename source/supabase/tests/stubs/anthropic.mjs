// Stand-in for `@anthropic-ai/sdk`: no network, the reply is whatever the
// test put in fakes.modelText.
import { calls, fakes } from './stubs.mjs'

export default class Anthropic {
  messages = {
    create: async () => {
      calls.anthropic++
      return { content: [{ type: 'text', text: fakes.modelText }] }
    },
  }
}
