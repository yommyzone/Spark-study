import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function balanceQuizOptions(quiz: any[]) {
  return quiz.map((item, index) => {
    const options = Array.isArray(item.options) ? [...item.options] : []
    if (options.length < 2) return item
    const correct = options[Number(item.answer) || 0]
    const shift = index % options.length
    const rotated = options.slice(shift).concat(options.slice(0, shift))
    return { ...item, options: rotated, answer: Math.max(0, rotated.indexOf(correct)) }
  })
}

function fallbackQuiz(text: string) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 45)
  const stopWords = new Set(['about', 'there', 'their', 'which', 'these', 'those', 'would', 'could', 'should', 'because', 'through', 'where', 'while', 'between', 'important', 'following'])
  const terms = [...new Set((text.match(/[A-Za-z][A-Za-z'-]{4,}/g) || []).map(word => word.toLowerCase()).filter(word => !stopWords.has(word)))]
  const questions = []
  for (let i = 0; i < 16; i++) {
    const sentence = sentences[i % Math.max(sentences.length, 1)] || text.slice(0, 180)
    const wordsInSentence = [...new Set((sentence.match(/[A-Za-z][A-Za-z'-]{4,}/g) || []).map(word => word.toLowerCase()).filter(word => !stopWords.has(word)))]
    const answer = wordsInSentence[0] || terms[i % Math.max(terms.length, 1)] || 'concept'
    const blanked = sentence.replace(new RegExp(`\\b${answer}\\b`, 'i'), '_____')
    const distractors = terms.filter(term => term !== answer).slice(i % 5, i % 5 + 3)
    while (distractors.length < 3) distractors.push(['process', 'system', 'example', 'method', 'result'][distractors.length])
    const options = [answer, ...distractors.slice(0, 3)]
    const shift = i % options.length
    const rotated = options.slice(shift).concat(options.slice(0, shift))
    questions.push({ question: `Which important term completes this statement from the material? ${blanked}`, options: rotated, answer: rotated.indexOf(answer), explanation: `The material states this in relation to ${answer}.` })
  }
  return questions
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
    quiz: fallbackQuiz(text),
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
    const { data: profile } = await supabase.from('profiles').select('plan,subscription_status,subscription_expires_at').eq('id', userData.user.id).single()
    const premium = profile?.plan === 'premium' && profile.subscription_status === 'active' && (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())
    const monthStart = new Date(); monthStart.setUTCDate(1); const usageMonth = monthStart.toISOString().slice(0, 10)
    const { data: usage } = await supabase.from('usage_monthly').select('ai_generations_used').eq('user_id', userData.user.id).eq('usage_month', usageMonth).maybeSingle()
    const aiLimit = premium ? 100 : 5
    if ((usage?.ai_generations_used || 0) >= aiLimit) throw new Error(`${premium ? 'Premium' : 'Free'} AI generation limit reached: ${aiLimit} this month.`)

    let result
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    try {
      if (!geminiKey) throw new Error('GEMINI_API_KEY is not configured.')
      const prompt = `You are Spark Study, a clear and encouraging study coach. Read the material carefully and return ONLY valid JSON with these keys. Make the summary comprehensive for revision: explain the central idea, important context, major concepts, relationships, examples and exam-relevant takeaways. Use plain text paragraphs with short section labels: summary (350 to 500 words), explanation (a simple student-friendly explanation), key_points (8 short points), flashcards (8 objects with question and answer), quiz (at least 16 objects with question, options as an array of 4 strings, and answer as the zero-based correct option index). Do not use markdown fences. Material title: ${material.title}\n\nMaterial:\n${material.extracted_text.slice(0, 50000)}`
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
      if (!Array.isArray(result.quiz) || result.quiz.length < 16) result.quiz = fallbackQuiz(material.extracted_text)
      else result.quiz = balanceQuizOptions(result.quiz)
      result.source = 'gemini'
    } catch (aiError) {
      console.warn('Gemini unavailable; using local fallback:', aiError instanceof Error ? aiError.message : aiError)
      result = fallbackResult(material.title, material.extracted_text)
    }

    const { error: updateError } = await supabase.from('materials').update({ summary: result.summary || '', explanation: result.explanation || '', key_points: result.key_points || [], generated_quiz: result.quiz || [], status: 'ready', generated_at: new Date().toISOString() }).eq('id', material.id)
    if (updateError) throw updateError
    await supabase.from('usage_monthly').upsert({ user_id: userData.user.id, usage_month: usageMonth, ai_generations_used: (usage?.ai_generations_used || 0) + 1 }, { onConflict: 'user_id,usage_month' })
    return new Response(JSON.stringify({ ...result, materialId: material.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary failed.'
    console.error('summarize-material failed:', message)
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
