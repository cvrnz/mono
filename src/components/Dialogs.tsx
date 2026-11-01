import { Button, Modal } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { dismissToast, useDialog, useToasts, type Dialog } from '../lib/dialogs'

function ChooseBody({ d }: { d: Extract<Dialog, { kind: 'choose' }> }) {
  return (
    <>
      {d.message && (
        <Modal.Body>
          <p className="text-[13px] text-[var(--dim)] whitespace-pre-wrap">{d.message}</p>
        </Modal.Body>
      )}
      <Modal.Footer>
        {d.buttons.map((b, i) => (
          <Button
            key={b.value}
            size="sm"
            variant={b.variant ?? 'secondary'}
            autoFocus={i === d.buttons.length - 1}
            onPress={() => d.resolve(b.value)}
          >
            {b.label}
          </Button>
        ))}
      </Modal.Footer>
    </>
  )
}

function PromptBody({ d }: { d: Extract<Dialog, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(d.value)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const [a, b] = d.select ?? [d.value.length, d.value.length]
    el.setSelectionRange(a, b)
  }, [d])
  return (
    <>
      <Modal.Body>
        {d.message && <p className="mb-2 text-[12px] text-[var(--dim)]">{d.message}</p>}
        <input
          ref={input}
          className="dialog-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              d.resolve(value)
            }
          }}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="tertiary" onPress={() => d.resolve(null)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onPress={() => d.resolve(value)}>
          OK
        </Button>
      </Modal.Footer>
    </>
  )
}

export default function Dialogs() {
  const d = useDialog()
  const toasts = useToasts()
  const cancel = () => {
    if (!d) return
    if (d.kind === 'choose') d.resolve(d.cancel)
    else d.resolve(null)
  }
  return (
    <>
      <Modal.Backdrop isOpen={d !== null} onOpenChange={(open) => !open && cancel()}>
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog aria-label={d?.title ?? 'Dialog'}>
            {d && (
              <>
                <Modal.Header>
                  <Modal.Heading>{d.title}</Modal.Heading>
                </Modal.Header>
                {d.kind === 'choose' ? <ChooseBody d={d} /> : <PromptBody key={d.title + d.value} d={d} />}
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
