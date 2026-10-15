const READY_KEY = 'vault-breakin-ready'

export function breakInCameraReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1'
  } catch {
    return false
  }
}

export async function enableBreakInCamera(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
    localStorage.setItem(READY_KEY, '1')
    return true
  } catch {
    localStorage.removeItem(READY_KEY)
    return false
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

/** Capture only when the user already granted the camera. Never prompts from a failed PIN. */
export async function captureBreakInFrame(): Promise<{ image: string } | { unavailable: true }> {
  if (!breakInCameraReady() || !navigator.mediaDevices?.getUserMedia) return { unavailable: true }
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    const width = video.videoWidth || 320
    const height = video.videoHeight || 240
    if (!width || !height) return { unavailable: true }
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(width, 480)
    canvas.height = Math.round((height / width) * canvas.width)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { unavailable: true }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = canvas.toDataURL('image/jpeg', 0.7)
    if (!image.startsWith('data:image/jpeg')) return { unavailable: true }
    return { image }
  } catch {
    return { unavailable: true }
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}
