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
    const { data: profile } = await supabase.from('profiles').select('plan,subscription_status,subscription_expires_at').eq('id', userData.user.id).single()
    const premium = profile?.plan === 'premium' && profile.subscription_status === 'active' && (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())
    const { count: materialCount } = await supabase.from('materials').select('id', { count: 'exact', head: true }).eq('user_id', userData.user.id)
    if (!premium && (materialCount || 0) >= 10) throw new Error('Free plan limit reached: 10 active materials. Upgrade to Premium for more.')
    const month = new Date(); month.setUTCDate(1); const usageMonth = month.toISOString().slice(0, 10)
    const { data: usage } = await supabase.from('link_usage').select('links_used').eq('user_id', userData.user.id).eq('usage_month', usageMonth).maybeSingle()
    if (!premium && (usage?.links_used || 0) >= 3) throw new Error('Free link limit reached: 3 links this month. Upgrade to Premium for more.')
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
    if (!premium) {
      await supabase.from('link_usage').upsert({ user_id: userData.user.id, usage_month: usageMonth, links_used: (usage?.links_used || 0) + 1 }, { onConflict: 'user_id,usage_month' })
    }
    return new Response(JSON.stringify({ material, premium, linksRemaining: premium ? null : Math.max(0, 2 - (usage?.links_used || 0)) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this link.'
    console.error('read-link failed:', message)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
