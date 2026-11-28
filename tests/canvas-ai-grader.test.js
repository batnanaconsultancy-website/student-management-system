import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANVAS_AI_RESULT_SCHEMA,
  normalizeCanvasRubric,
  requestOpenAiCanvasGrade,
  validateCanvasAiAssessment,
} from '../server/utils/canvasAiGrader.js'

const rubric = [
  {
    id: 'criterion-1',
    description: 'Problem analysis',
    long_description: 'Identify the problem and explain its context.',
    ratings: [
      { description: 'Needs work', points: 0 },
      { description: 'Developing', points: 2 },
      { description: 'Excellent', points: 4 },
    ],
  },
  {
    id: 'criterion-2',
    description: 'Proposed solution',
    points: 6,
    ratings: [
      { description: 'Needs work', points: 0 },
      { description: 'Excellent', points: 6 },
    ],
  },
]

const assessment = {
  criterion_feedback: [
    { criterion_id: 'criterion-1', criterion_name: 'Problem analysis', score: 3, max_score: 4, evidence: 'The opening paragraph defines the issue.', feedback: 'Add context and impact.', confidence: 'high' },
    { criterion_id: 'criterion-2', criterion_name: 'Proposed solution', score: 5, max_score: 6, evidence: 'The final section proposes a solution.', feedback: 'Explain implementation trade-offs.', confidence: 'medium' },
  ],
  overall_feedback: 'A strong submission with room for more detail.',
  rationale: 'The evidence meets most rubric expectations.',
}

function mockResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

test('normalizes Canvas rubric criteria and maximum scores', () => {
  const normalized = normalizeCanvasRubric(rubric)
  assert.deepEqual(normalized.map((item) => item.maxScore), [4, 6])
  assert.equal(normalized[0].id, 'criterion-1')
})

test('rejects missing rubric criteria', () => {
  assert.throws(() => normalizeCanvasRubric([]), /no captured Canvas rubric/i)
})

test('validates every criterion and calculates the suggested score', () => {
  const result = validateCanvasAiAssessment(assessment, rubric)
  assert.equal(result.suggested_score, 8)
  assert.equal(result.suggested_grade, null)
  assert.equal(result.criterion_feedback.length, 2)
})

test('rejects missing, duplicate or out-of-range criterion scores', () => {
  assert.throws(() => validateCanvasAiAssessment({ ...assessment, criterion_feedback: assessment.criterion_feedback.slice(0, 1) }, rubric), /every rubric criterion/i)
  assert.throws(() => validateCanvasAiAssessment({ ...assessment, criterion_feedback: assessment.criterion_feedback.map((item, index) => index ? item : { ...item, score: 5 }) }, rubric), /out-of-range/i)
})

test('uses Responses API JSON Schema and parses mocked output without network access', async () => {
  let request
  const result = await requestOpenAiCanvasGrade({
    apiKey: 'test-key',
    model: 'test-model',
    attempt: { attempt: 1, submitted_at: '2026-11-28T10:00:00Z', body: 'The submission contains evidence.', attachments: [] },
    assignment: { name: 'Test assignment', points_possible: 10 },
    rubric,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) }
      return mockResponse({
        id: 'resp_test',
        status: 'completed',
        model: 'test-model',
        output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(assessment) }] }],
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    },
  })

  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  assert.ok(request.options.signal instanceof AbortSignal)
  assert.equal(request.body.store, false)
  assert.equal(request.body.text.format.type, 'json_schema')
  assert.deepEqual(request.body.text.format.schema, CANVAS_AI_RESULT_SCHEMA)
  assert.equal(result.assessment.suggested_score, 8)
  assert.equal(result.model, 'test-model')
})

test('does not grade attachment-only submissions as if file contents were read', async () => {
  await assert.rejects(() => requestOpenAiCanvasGrade({
    apiKey: 'test-key', model: 'test-model', attempt: { body: '', attachments: [{ filename: 'report.pdf', download_status: 'archived' }] },
    assignment: {}, rubric, fetchImpl: async () => { throw new Error('network should not be called') },
  }), /Attachment-only grading is not supported/i)
})

test('marks OpenAI rate limits as retryable', async () => {
  await assert.rejects(() => requestOpenAiCanvasGrade({
    apiKey: 'test-key', model: 'test-model', attempt: { body: 'submission text' }, assignment: {}, rubric,
    fetchImpl: async () => mockResponse({ error: { message: 'Rate limited' } }, 429),
  }), (error) => error.message === 'Rate limited' && error.retryable === true)
})


test('does not retry an incomplete OpenAI response', async () => {
  await assert.rejects(() => requestOpenAiCanvasGrade({
    apiKey: 'test-key', model: 'test-model', attempt: { body: 'submission text' }, assignment: {}, rubric,
    fetchImpl: async () => mockResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
  }), (error) => error.retryable === false && /incomplete/i.test(error.message))
})

test('does not retry an OpenAI refusal', async () => {
  await assert.rejects(() => requestOpenAiCanvasGrade({
    apiKey: 'test-key', model: 'test-model', attempt: { body: 'submission text' }, assignment: {}, rubric,
    fetchImpl: async () => mockResponse({
      status: 'completed',
      output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'Cannot grade this request.' }] }],
    }),
  }), (error) => error.retryable === false && /refused/i.test(error.message))
})
