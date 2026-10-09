// Stand-in for `@anthropic-ai/sdk`: no network, the reply is whatever the
// test put in fakes.modelText.
import { calls, fakes } from './stubs.mjs'

export default class Anthropic {
  messages = {
    create: async () => {
      calls.anthropic++
      if (fakes.modelError) throw fakes.modelError
      return { content: [{ type: 'text', text: fakes.modelText }], usage: { input_tokens: 120, output_tokens: 45 } }
    },
  }
}
