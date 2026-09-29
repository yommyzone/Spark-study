import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function cleanHtml(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('You must be signed in.')
    const rawKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
    const apiKey = rawKeys ? JSON.parse(rawKeys).default : Deno.env.get('SUPABASE_ANON_KEY')
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, apiKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) throw new Error('Your session has expired. Please sign in again.')
    const { url } = await req.json()
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links are supported.')
    const response = await fetch(url, { headers: { 'User-Agent': 'SparkStudyReader/1.0' }, redirect: 'follow' })
    if (!response.ok) throw new Error(`The page returned ${response.status}.`)
    const html = await response.text()
    const extractedText = cleanHtml(html).slice(0, 50000)
    if (extractedText.length < 80) throw new Error('We could not find readable text on that page.')
    const title = new URL(url).hostname.replace(/^www\./, '')
    const { data: material, error } = await supabase.from('materials').insert({ user_id: userData.user.id, title, file_name: url, storage_path: `link:${url}`, mime_type: 'text/html', size_bytes: extractedText.length, status: 'ready', extracted_text: extractedText }).select('id,title').single()
    if (error) throw error
    return new Response(JSON.stringify({ material }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this link.'
    console.error('read-link failed:', message)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
