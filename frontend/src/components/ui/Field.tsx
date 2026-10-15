import React from 'react'
import './ui.css'

type Shared = {
  // Anything the field says about itself ("Titles can be up to 200 characters.").
  error?: string
}
type InputProps = Shared & { multiline?: false } & React.InputHTMLAttributes<HTMLInputElement>
type AreaProps = Shared & { multiline: true } & React.TextareaHTMLAttributes<HTMLTextAreaElement>

/** A borderless text field: the placeholder in the shared muted colour, one focus treatment.
 *  Used for notes, codes, a place name, a trip name. */
export const Field = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  InputProps | AreaProps
>(function Field(props, ref) {
  const { error, className, ...rest } = props as Shared & {
    className?: string
    multiline?: boolean
  }
  const c = [
    'ui-field',
    rest.multiline ? 'is-multiline' : '',
    error ? 'has-error' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  const { multiline, ...dom } = rest as { multiline?: boolean } & Record<string, unknown>
  return (
    <>
      {multiline ? (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          className={c}
          aria-invalid={!!error}
          {...(dom as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={c}
          aria-invalid={!!error}
          {...(dom as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error && (
        <p role="alert" className="ui-field-error">
          {error}
        </p>
      )}
    </>
  )
})
