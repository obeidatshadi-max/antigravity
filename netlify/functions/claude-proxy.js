// ═══════════════════════════════════════════════════════════
//  claude-proxy.js  —  Netlify Serverless Function
//  Sits between Verbal Mirror and Anthropic API.
//  Your API key never reaches the browser.
// ═══════════════════════════════════════════════════════════

exports.handler = async function(event) {

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' }
  }

  // Get secret key from Netlify environment
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables.' })
    }
  }

  try {
    const body = JSON.parse(event.body)

    // Call Anthropic with 30 second timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      body.model      || 'claude-haiku-4-5-20251001',
        max_tokens: body.max_tokens || 4000,
        system:     body.system     || '',
        messages:   body.messages   || [],
      }),
    })

    clearTimeout(timeout)

    const data = await response.json()
    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data),
    }

  } catch (err) {
    const isTimeout = err.name === 'AbortError'
    return {
      statusCode: isTimeout ? 504 : 500,
      headers,
      body: JSON.stringify({
        error: isTimeout ? 'Request timed out — try again.' : err.message
      }),
    }
  }
}
