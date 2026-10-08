// `node --import ./register.mjs --test ...`: see resolve-hooks.mjs.
import { register } from 'node:module'

register('./resolve-hooks.mjs', import.meta.url)
