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
    let apiKey = legacyAnon
    if (publishableKeys) {
      try { apiKey = JSON.parse(publishableKeys).default || apiKey } catch (_) { /* use legacy key */ }
    }
    if (!apiKey) throw new Error('Supabase publishable key is not available to this function.')
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
    const modelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + geminiKey)
    if (!modelsResponse.ok) throw new Error(`Gemini model list failed (${modelsResponse.status}): ${(await modelsResponse.text()).slice(0, 300)}`)
    const modelsJson = await modelsResponse.json()
    const available = (modelsJson.models || []).filter((model: { name?: string, supportedGenerationMethods?: string[] }) => model.name && model.supportedGenerationMethods?.includes('generateContent') && /flash/i.test(model.name))
    const preferred = ['gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
    const supported = preferred.map(name => available.find((model: { name?: string }) => model.name?.replace(/^models\//, '') === name)).find(Boolean) || available[0]
    if (!supported?.name) throw new Error('No Gemini Flash model available for this API key. Open Google AI Studio and create a new key for a project with Gemini API access.')
    const candidateModels = ['gemini-3.6-flash-lite', 'gemini-3.6-flash']
    let geminiResponse: Response | null = null
    let lastFailure = ''
    for (const modelName of candidateModels) {
      for (let attempt = 0; attempt < 2; attempt++) {
        geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelName) + ':generateContent?key=' + geminiKey, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } })
        })
        if (geminiResponse.ok) break
        lastFailure = `Gemini request failed (${geminiResponse.status}): ${(await geminiResponse.text()).slice(0, 300)}`
        if (geminiResponse.status !== 429 && geminiResponse.status !== 503) break
        await new Promise(resolve => setTimeout(resolve, 800))
      }
      if (geminiResponse?.ok) break
    }
    if (!geminiResponse?.ok) throw new Error(lastFailure || 'Gemini is temporarily unavailable. Please try again.')
    const geminiJson = await geminiResponse.json()
    const raw = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) throw new Error('Gemini returned an empty response.')
    const result = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''))

    const { error: updateError } = await supabase.from('materials').update({ summary: result.summary || '', explanation: result.explanation || '', key_points: result.key_points || [], status: 'ready', generated_at: new Date().toISOString() }).eq('id', material.id)
    if (updateError) throw updateError
    return new Response(JSON.stringify({ ...result, materialId: material.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary failed.'
    console.error('summarize-material failed:', message)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
