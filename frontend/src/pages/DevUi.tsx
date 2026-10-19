// Dev only (the route is not in a production build): every UI primitive and state, and each
// Sheet variant, at phone and desktop widths side by side. Keep it in step with components/ui.
import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Airplane, Bed, CallBell, Lightbulb, Moon, Train } from '@phosphor-icons/react'
import {
  Button,
  Chip,
  ChipGroup,
  DetailGroup,
  EmptyState,
  Field,
  NavRow,
  Note,
  Pip,
  Row,
  SectionLabel,
  Sheet,
  SheetActions,
  SheetFooter,
  SheetIdentity,
  Stamp,
  StepSlider,
  Switch,
  type SheetVariant,
} from '@components/ui'

const DevStepSlider: React.FC = () => {
  const [v, setV] = useState<'off' | 'suggest' | 'assist'>('suggest')
  return (
    <StepSlider
      label="Butler"
      value={v}
      onChange={setV}
      steps={[
        { value: 'off', label: 'Off', icon: <Moon weight="bold" /> },
        { value: 'suggest', label: 'Suggest', icon: <Lightbulb weight="bold" /> },
        { value: 'assist', label: 'Assist', icon: <CallBell weight="bold" /> },
      ]}
    />
  )
}

const CATEGORIES = ['food', 'sight', 'activity', 'transport', 'stay', 'shopping', 'other'] as const

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="dev-block">
    <SectionLabel>{title}</SectionLabel>
    <div className="dev-row">{children}</div>
  </section>
)

const Gallery: React.FC = () => {
  const [open, setOpen] = useState<SheetVariant | null>(null)
  const [kind, setKind] = useState<'flight' | 'stay' | 'train'>('stay')
  const [on, setOn] = useState(true)
  const close = () => setOpen(null)
  return (
    <div className="dev-gallery">
      <Block title="Button: key, quiet, text, danger">
        <Button kind="key">Open Maps</Button>
        <Button kind="key" disabled>
          Disabled key
        </Button>
        <Button kind="key" danger>
          Discard
        </Button>
        <Button kind="quiet">Show code</Button>
        <Button kind="quiet" autoFocus>
          Focused
        </Button>
        <Button kind="quiet" disabled>
          Disabled
        </Button>
        <Button kind="text">Edit</Button>
        <Button kind="text" danger>
          Delete
        </Button>
      </Block>
      <Block title="Chip (hover, selected = open)">
        <Chip label="Day" value="Thu 15">
          {() => <p>A day list goes here.</p>}
        </Chip>
        <Chip label="Time" value="+ Time" empty>
          {() => <p>Times.</p>}
        </Chip>
        <Chip label="Day" value="Disabled" disabled>
          {() => null}
        </Chip>
      </Block>
      <Block title="ChipGroup (selected)">
        <ChipGroup
          label="Kind"
          value={kind}
          options={[
            { value: 'flight', label: 'Flight', icon: <Airplane /> },
            { value: 'stay', label: 'Stay', icon: <Bed /> },
            { value: 'train', label: 'Train', icon: <Train /> },
          ]}
          onChange={setKind}
          columns={3}
        />
      </Block>
      <Block title="StepSlider (drag, tap a name, or arrow keys)">
        <DevStepSlider />
        <StepSlider
          label="Disabled"
          value="suggest"
          disabled
          onChange={() => {}}
          steps={[
            { value: 'off', label: 'Off', icon: <Moon weight="bold" /> },
            { value: 'suggest', label: 'Suggest', icon: <Lightbulb weight="bold" /> },
            { value: 'assist', label: 'Assist', icon: <CallBell weight="bold" /> },
          ]}
        />
      </Block>
      <Block title="Field, Switch">
        <Field aria-label="A field" placeholder="Add a note" />
        <Field aria-label="With an error" defaultValue="Too long" error="That note is too long." />
        <Switch aria-label="On" checked={on} onChange={setOn} />
        <Switch aria-label="Off" checked={false} onChange={() => {}} />
        <Switch aria-label="Disabled" checked disabled onChange={() => {}} />
      </Block>
      <Block title="Stamp, Pip">
        {CATEGORIES.map((c) => (
          <Stamp key={c} category={c}>
            {c}
          </Stamp>
        ))}
        <Stamp tone="used">Used</Stamp>
        <Stamp tone="done">Day done</Stamp>
        {CATEGORIES.map((c) => (
          <Pip key={c} category={c} />
        ))}
        <Pip done />
        <Pip category="sight" hollow />
        {[0, 1, 2, 3, 4, 5].map((d) => (
          <Pip key={d} day={d} />
        ))}
      </Block>
      <Block title="SectionLabel, Note (muted, warn), EmptyState">
        <SectionLabel>This trip</SectionLabel>
        <Note>These are dated outside 13–21 Oct.</Note>
        <Note tone="warn">Lunch and Walk overlap at 12:30</Note>
        <Note tone="warn" onClick={() => {}}>
          A line that opens the later item
        </Note>
        <EmptyState
          title="Where to first?"
          action={<Button kind="key">When are you going?</Button>}
        >
          Add a place or a plan below.
        </EmptyState>
      </Block>
      <Block title="Row, NavRow, DetailGroup">
        <div style={{ width: '100%', ['--tcol' as string]: 'calc(var(--time-w) + var(--gap))' }}>
          <Row
            lead={<input type="checkbox" aria-label="done" />}
            time="12:30"
            trail={<Pip category="food" />}
          >
            Lunch at Tascantiga
          </Row>
          <Row lead={<Bed />} time="Tonight">
            Alfama flat
          </Row>
        </div>
        <DetailGroup label="Details">
          <NavRow label="When" value="Thu 15, 14:00 · 2 h" />
          <NavRow label="Place" value="Quinta da Regaleira, Sintra" />
          <NavRow label="Booking" value="None" empty />
          <NavRow label="Note" value="Add a note" empty />
          <NavRow label="Disabled" value="No" disabled />
        </DetailGroup>
        <div style={{ width: '100%' }}>
          <NavRow layout="list" label="Thu 15" value="Sintra" current />
          <NavRow layout="list" label="Fri 16" value="Nothing planned" />
        </div>
      </Block>
      <Block title="Sheet variants">
        {(['sheet', 'panel', 'slip', 'confirm', 'chips'] as SheetVariant[]).map((v) => (
          <Button key={v} kind="quiet" onClick={() => setOpen(v)}>
            {v}
          </Button>
        ))}
      </Block>
      {open && (
        <Sheet
          variant={open}
          label={`A ${open}`}
          onClose={close}
          identity={
            <SheetIdentity
              leading={<Bed />}
              title="Alfama flat"
              context="Now · until Sun 18, 11:00"
            />
          }
          actions={
            <SheetActions>
              {open !== 'slip' && <Button kind="key">Open Maps</Button>}
              <Button kind="quiet">Show code</Button>
            </SheetActions>
          }
          details={
            <DetailGroup>
              <NavRow label="Check-in" value="Tue 13, 15:00" />
              <NavRow label="Code" value="•••• 211" />
              <NavRow label="Note" value="Add a note" empty />
            </DetailGroup>
          }
          footer={<SheetFooter who="Added by Mia · Mon" onDelete={close} />}
        />
      )}
    </div>
  )
}

/** /dev/ui: the gallery at 375px and 1100px side by side (each is a frame with its own
 *  viewport, so the media queries really apply). */
export const DevUi: React.FC = () => {
  const [params] = useSearchParams()
  if (params.get('frame')) return <Gallery />
  return (
    <div className="dev-frames">
      <figure>
        <figcaption>Phone, 375px</figcaption>
        <iframe title="Phone" src="/dev/ui?frame=phone" width={375} height={900} />
      </figure>
      <figure>
        <figcaption>Desktop, 1100px</figcaption>
        <iframe title="Desktop" src="/dev/ui?frame=desktop" width={1100} height={900} />
      </figure>
    </div>
  )
}

export default DevUi
