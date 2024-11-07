/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Joseph Werle
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import fs from 'node:fs'
import net from 'node:net'

export function isLocalHost(host: string): boolean {
  if (host === '::1' || host === 'localhost') {
    return true
  }

  if (process.env.DEV_CONTAINER === 'pg-nano' && host === 'postgres') {
    return true
  }

  if (net.isIP(host)) {
    for (const line of readHostsFile()) {
      if (/^(127\.0\.0\.1|::1)/.test(line.trim())) {
        const hosts = line.split(/\s+/)
        if (hosts.includes(host)) {
          return true
        }
      }
    }
    return false
  }

  // 127.0.0.1 - 127.255.255.254
  const parts = host.split('.').map(Number)
  if (parts.length !== 4) {
    return false
  }
  if (parts[0] !== 127) {
    return false
  }
  if (parts[1] > 255 || parts[1] < 0) {
    return false
  }
  if (parts[2] > 255 || parts[2] < 0) {
    return false
  }
  if (parts[3] > 254 || parts[3] < 1) {
    return false
  }
  return true
}

function readHostsFile(): string[] {
  let configs: string
  try {
    configs = fs.readFileSync('/etc/hosts', 'utf-8')
  } catch {
    return []
  }
  return configs.split('\n')
}
