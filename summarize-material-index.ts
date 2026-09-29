import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function fallbackResult(title: string, text: string) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean)
  const summary = sentences.slice(0, 18).join(' ').slice(0, 3000)
  const keyPoints = sentences.slice(0, 8).map(sentence => sentence.trim().slice(0, 240))
  return {
    summary: `Study summary: ${title}\n\n${summary}`,
    explanation: `In simple terms, this material is about ${sentences.slice(0, 3).join(' ').slice(0, 900)}`,
    key_points: keyPoints,
    flashcards: [],
    quiz: [],
    source: 'local-fallback',
  }
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
    if (publishableKeys) { try { apiKey = JSON.parse(publishableKeys).default || apiKey } catch (_) {} }
    if (!apiKey) throw new Error('Supabase publishable key is not available to this function.')
    const supabase = createClient(supabaseUrl, apiKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) throw new Error('Your session has expired. Please sign in again.')
    const { materialId } = await req.json()
    if (!materialId) throw new Error('A materialId is required.')
    const { data: material, error: materialError } = await supabase.from('materials').select('id, title, extracted_text').eq('id', materialId).single()
    if (materialError || !material) throw new Error('Material not found.')
    if (!material.extracted_text?.trim()) throw new Error('This material has no extracted text yet.')

    let result
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    try {
      if (!geminiKey) throw new Error('GEMINI_API_KEY is not configured.')
      const prompt = `You are Spark Study, a clear and encouraging study coach. Read the material carefully and return ONLY valid JSON with these keys. Make the summary comprehensive for revision: explain the central idea, important context, major concepts, relationships, examples and exam-relevant takeaways. Use plain text paragraphs with short section labels: summary (350 to 500 words), explanation (a simple student-friendly explanation), key_points (8 short points), flashcards (8 objects with question and answer), quiz (8 objects with question, options as an array of 4 strings, and answer as the zero-based correct option index). Do not use markdown fences. Material title: ${material.title}\n\nMaterial:\n${material.extracted_text.slice(0, 50000)}`
      const models = ['gemini-3.6-flash-lite', 'gemini-3.6-flash']
      let response: Response | null = null
      let lastFailure = ''
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }) })
          if (response.ok) break
          lastFailure = `Gemini request failed (${response.status}): ${(await response.text()).slice(0, 300)}`
          if (response.status !== 429 && response.status !== 503) break
          await new Promise(resolve => setTimeout(resolve, 800))
        }
        if (response?.ok) break
      }
      if (!response?.ok) throw new Error(lastFailure || 'Gemini is temporarily unavailable.')
      const json = await response.json()
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text
      if (!raw) throw new Error('Gemini returned an empty response.')
      result = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''))
      result.source = 'gemini'
    } catch (aiError) {
      console.warn('Gemini unavailable; using local fallback:', aiError instanceof Error ? aiError.message : aiError)
      result = fallbackResult(material.title, material.extracted_text)
    }

    const { error: updateError } = await supabase.from('materials').update({ summary: result.summary || '', explanation: result.explanation || '', key_points: result.key_points || [], generated_quiz: result.quiz || [], status: 'ready', generated_at: new Date().toISOString() }).eq('id', material.id)
    if (updateError) throw updateError
    return new Response(JSON.stringify({ ...result, materialId: material.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary failed.'
    console.error('summarize-material failed:', message)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
