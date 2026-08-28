function collectErrorChain(error: unknown) {
  const messages: string[] = []
  const codes: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error && current.message) messages.push(current.message)
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string' && record.code) codes.push(record.code)
    current = record.cause
  }
  return { messages, codes }
}

export function describeNetworkError(error: unknown, target = 'OpenAI') {
  const { messages, codes } = collectErrorChain(error)
  const blob = [...codes, ...messages].join(' ')

  if (/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(blob)) {
    return `Could not reach ${target}: HTTPS is being intercepted with a certificate Node.js does not trust (corporate TLS inspection). Run the app with NODE_OPTIONS=--use-system-ca so Node uses your system certificate store.`
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(blob)) {
    return `Could not reach ${target}: DNS lookup for api.openai.com failed. Check your network connection.`
  }
  if (/ECONNREFUSED/i.test(blob)) {
    return `Could not reach ${target}: the connection was refused.`
  }
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|TimeoutError/i.test(blob)) {
    return `Could not reach ${target}: the connection timed out.`
  }
  if (/ECONNRESET|UND_ERR_SOCKET/i.test(blob)) {
    return `Could not reach ${target}: the connection was reset.`
  }
  if (/CERT_HAS_EXPIRED/i.test(blob)) {
    return `Could not reach ${target}: the TLS certificate has expired.`
  }

  const detail = [...new Set([...codes, ...messages.filter((message) => message !== 'fetch failed')])]
    .filter(Boolean)
    .join(' — ')
  return detail ? `Could not reach ${target}: ${detail}` : `Could not reach ${target}.`
}
