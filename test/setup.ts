import * as pgtmp from '@pg-nano/pg-tmp'
import debug from 'debug'
import './inspect.js'

debug.log = console.log.bind(console)

process.env.PG_TMP_DSN = await pgtmp.start()
