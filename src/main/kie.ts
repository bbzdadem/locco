// Every call to kie.ai goes through here.
// kie returns HTTP 200 even on failure, with the real error in the body ({code, msg} or {error}), so every response is checked.
const API = 'https://api.kie.ai'
const UPLOAD = 'https://kieai.redpandaai.co'

let key = ''
export const setKey = (k: string) => (key = k.trim())
export const hasKey = () => !!key

const auth = () => ({ Authorization: `Bearer ${key}` })
const json = () => ({ ...auth(), 'Content-Type': 'application/json' })

export function errorOf(body: any): string | null {
  if (body?.error) return body.error.message ?? String(body.error)
  if (typeof body?.code === 'number' && body.code !== 200) return `${body.msg ?? 'kie error'} (code ${body.code})`
  return null
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  if (!key) throw new Error('Add your kie.ai API key in Settings.')
  const res = await fetch(url, init)
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`kie answered HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const err = errorOf(body) ?? (res.ok ? null : `kie answered HTTP ${res.status}`)
  if (err) throw new Error(err)
  return body
}

export const credits = async () => (await call<{ data: number }>(`${API}/api/v1/chat/credit`, { headers: auth() })).data

export async function createTask(model: string, input: Record<string, unknown>) {
  const body = await call<{ data: { taskId: string } }>(`${API}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ model, input }),
  })
  return body.data.taskId
}

export type TaskInfo = { state: string; resultJson?: string; failMsg?: string; failCode?: string; creditsConsumed?: number }
export const taskInfo = async (taskId: string) =>
  (await call<{ data: TaskInfo }>(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth() })).data

// Uploads are free and kie deletes them after 24 hours.
export async function upload(bytes: Uint8Array, name: string, mime: string) {
  const form = new FormData()
  form.append('file', new Blob([bytes.slice()], { type: mime }), name)
  form.append('uploadPath', 'locco')
  const body = await call<{ data: { downloadUrl: string } }>(`${UPLOAD}/api/file-stream-upload`, { method: 'POST', headers: auth(), body: form })
  return body.data.downloadUrl
}

// Server-sent events from a chat endpoint, parsed to JSON. Errors arrive as a plain JSON body instead of a stream.
export async function* stream(path: string, body: object, signal: AbortSignal): AsyncGenerator<any> {
  if (!key) throw new Error('Add your kie.ai API key in Settings.')
  const res = await fetch(API + path, { method: 'POST', headers: json(), body: JSON.stringify({ ...body, stream: true }), signal })
  if (!res.headers.get('content-type')?.includes('event-stream')) {
    const text = await res.text()
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {}
    throw new Error(errorOf(parsed) ?? `kie answered HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += value.replace(/\r\n/g, '\n')
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf
        .slice(0, i)
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      buf = buf.slice(i + 2)
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data)
      const err = errorOf(event)
      if (err) throw new Error(err)
      yield event
    }
  }
}
