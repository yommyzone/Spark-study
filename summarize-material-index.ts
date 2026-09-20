import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('You must be signed in.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const publishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
    const legacyAnon = Deno.env.get('SUPABASE_ANON_KEY')
    const apiKey = publishableKeys ? JSON.parse(publishableKeys).default : legacyAnon
    const supabase = createClient(supabaseUrl, apiKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) throw new Error('Your session has expired. Please sign in again.')

    const { materialId } = await req.json()
    if (!materialId) throw new Error('A materialId is required.')
    const { data: material, error: materialError } = await supabase.from('materials').select('id, title, extracted_text').eq('id', materialId).single()
    if (materialError || !material) throw new Error('Material not found.')
    if (!material.extracted_text?.trim()) throw new Error('This material has no extracted text yet.')

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY is not configured.')

    const prompt = `You are Spark Study, a clear and encouraging study coach. Read the material below and return ONLY valid JSON with these keys: summary (a concise 120-word summary), explanation (a simple student-friendly explanation), key_points (an array of 5 short key points), flashcards (an array of 5 objects with question and answer), quiz (an array of 5 objects with question, options as an array of 4 strings, and answer as the zero-based correct option index). Do not use markdown fences. Material title: ${material.title}\n\nMaterial:\n${material.extracted_text.slice(0, 50000)}`
    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } })
    })
    if (!geminiResponse.ok) throw new Error('Gemini could not process this material.')
    const geminiJson = await geminiResponse.json()
    const raw = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) throw new Error('Gemini returned an empty response.')
    const result = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''))

    const { error: updateError } = await supabase.from('materials').update({ summary: result.summary || '', explanation: result.explanation || '', key_points: result.key_points || [], status: 'ready', generated_at: new Date().toISOString() }).eq('id', material.id)
    if (updateError) throw updateError
    return new Response(JSON.stringify({ ...result, materialId: material.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Summary failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
