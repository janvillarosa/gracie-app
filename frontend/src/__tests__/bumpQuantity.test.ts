import { bumpQuantity } from '@lib/bumpQuantity'

describe('bumpQuantity', () => {
  it('adds one, counting a missing quantity as one', () => {
    expect(bumpQuantity({}, {})).toBe('2')
    expect(bumpQuantity({ quantity: '3' }, {})).toBe('4')
    expect(bumpQuantity({ quantity: '1.5', unit: 'kg' }, {})).toBe('2.5')
  })

  it('adds the typed amount when the units agree', () => {
    expect(bumpQuantity({ quantity: '1', unit: 'kg' }, { quantity: '2', unit: 'kg' })).toBe('3')
    expect(bumpQuantity({ quantity: '2' }, { quantity: '4' })).toBe('6')
  })

  it('adds one when the typed unit differs', () => {
    expect(bumpQuantity({ quantity: '1', unit: 'kg' }, { quantity: '500', unit: 'g' })).toBe('2')
  })

  it('leaves a quantity that is not a plain number alone', () => {
    expect(bumpQuantity({ quantity: 'a few' }, {})).toBeNull()
    expect(bumpQuantity({ quantity: '1/2' }, {})).toBeNull()
  })
})
