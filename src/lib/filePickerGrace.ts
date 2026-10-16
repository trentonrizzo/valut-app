/** Short exemption for the native file picker. It is not an upload-wide lock bypass. */
const PICKER_MS = 10 * 60 * 1000
const RETURN_GRACE_MS = 8000

let until = 0
let sawHide = false
let releaseTimer = 0

export function filePickerAllowsBackground(now = Date.now()): boolean {
  return now < until
}

export function armFilePicker(now = Date.now()): void {
  until = now + PICKER_MS
  sawHide = false
  window.clearTimeout(releaseTimer)
}

export function noteFilePickerHidden(): void {
  if (filePickerAllowsBackground()) sawHide = true
}

export function noteFilePickerReturned(now = Date.now()): void {
  if (now >= until) return
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(() => {
    until = 0
    sawHide = false
  }, RETURN_GRACE_MS)
}

export function installFilePickerGrace(): () => void {
  const arm = (event: Event) => {
    if (targetsFileInput(event)) armFilePicker()
  }
  const onChange = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.type === 'file') noteFilePickerReturned()
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && sawHide) noteFilePickerReturned()
  }
  document.addEventListener('pointerdown', arm, true)
  document.addEventListener('click', arm, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('cancel', onChange, true)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    document.removeEventListener('pointerdown', arm, true)
    document.removeEventListener('click', arm, true)
    document.removeEventListener('change', onChange, true)
    document.removeEventListener('cancel', onChange, true)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearTimeout(releaseTimer)
  }
}

function targetsFileInput(event: Event): boolean {
  const nodes = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
  for (const node of nodes) {
    if (node instanceof HTMLInputElement && node.type === 'file') return true
    if (node instanceof HTMLLabelElement && node.querySelector('input[type="file"]')) return true
  }
  return false
}
