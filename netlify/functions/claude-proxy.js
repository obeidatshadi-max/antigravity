// ═══════════════════════════════════════════════════════════
//  claude-proxy.js  —  Netlify Serverless Function
//  Sits between Verbal Mirror and Anthropic API.
//  Your API key never reaches the browser.
// ═══════════════════════════════════════════════════════════

exports.handler = async function(event) {

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // CORS headers — allow your Netlify domain
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  // Get your secret key from Netlify environment variables
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'API key not configured on server.' })
    }
  }

  try {
    // Parse the request body from Verbal Mirror
    const body = JSON.parse(event.body)

    // Forward to Anthropic — inject the real key server-side
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      body.model      || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 4000,
        system:     body.system     || '',
        messages:   body.messages   || [],
      }),
    })

    const data = await response.json()

    // Pass the response back to the browser
    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data),
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
