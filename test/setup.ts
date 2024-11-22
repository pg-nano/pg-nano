import * as pgtmp from '@pg-nano/pg-tmp'
import './inspect.js'

process.env.PG_TMP_DSN = await pgtmp.start()
