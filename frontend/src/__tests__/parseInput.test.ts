import { describe, it, expect } from 'vitest'
import { parseInput, QUANTITY_UNITS } from '@lib/parseInput'

describe('parseInput', () => {
    // ─── Plain descriptions (no quantity/unit) ───────────────────────────────
    describe('plain items with no quantity', () => {
        it('returns description-only for a single word', () => {
            expect(parseInput('Milk')).toEqual({ quantity: '', unit: '', description: 'Milk' })
        })

        it('returns description-only for multi-word item with no leading number', () => {
            expect(parseInput('bell peppers')).toEqual({ quantity: '', unit: '', description: 'bell peppers' })
        })

        it('returns description-only for an adjective + noun', () => {
            expect(parseInput('chicken breast')).toEqual({ quantity: '', unit: '', description: 'chicken breast' })
        })

        it('returns description-only for items starting with a unit-like word but no number', () => {
            // "bag" at the start without a leading number is not a unit context
            expect(parseInput('bag of chips')).toEqual({ quantity: '', unit: '', description: 'bag of chips' })
        })
    })

    // ─── Number + non-unit word + rest (the original bug) ────────────────────
    describe('number followed by a non-unit word (bug fix)', () => {
        it('"2 bell peppers" — "bell" is not a unit', () => {
            expect(parseInput('2 bell peppers')).toEqual({ quantity: '2', unit: '', description: 'bell peppers' })
        })

        it('"5 large eggs" — "large" is not a unit', () => {
            expect(parseInput('5 large eggs')).toEqual({ quantity: '5', unit: '', description: 'large eggs' })
        })

        it('"3 red onions" — "red" is not a unit', () => {
            expect(parseInput('3 red onions')).toEqual({ quantity: '3', unit: '', description: 'red onions' })
        })

        it('"2 chicken breasts" — "chicken" is not a unit', () => {
            expect(parseInput('2 chicken breasts')).toEqual({ quantity: '2', unit: '', description: 'chicken breasts' })
        })

        it('"10 baby carrots" — "baby" is not a unit', () => {
            expect(parseInput('10 baby carrots')).toEqual({ quantity: '10', unit: '', description: 'baby carrots' })
        })

        it('"4 roma tomatoes" — "roma" is not a unit', () => {
            expect(parseInput('4 roma tomatoes')).toEqual({ quantity: '4', unit: '', description: 'roma tomatoes' })
        })

        it('"6 green apples" — "green" is not a unit', () => {
            expect(parseInput('6 green apples')).toEqual({ quantity: '6', unit: '', description: 'green apples' })
        })

        it('"1 whole chicken" — "whole" is not a unit', () => {
            expect(parseInput('1 whole chicken')).toEqual({ quantity: '1', unit: '', description: 'whole chicken' })
        })
    })

    // ─── Number + known unit + description ───────────────────────────────────
    describe('number + recognised unit + description', () => {
        it('"3 bags Milk"', () => {
            expect(parseInput('3 bags Milk')).toEqual({ quantity: '3', unit: 'bags', description: 'Milk' })
        })

        it('"1.5 kg Beef" (with space between number and unit)', () => {
            expect(parseInput('1.5 kg Beef')).toEqual({ quantity: '1.5', unit: 'kg', description: 'Beef' })
        })

        it('"2 Bottles Water" (capitalised unit)', () => {
            expect(parseInput('2 Bottles Water')).toEqual({ quantity: '2', unit: 'Bottles', description: 'Water' })
        })

        it('"3 cans tuna"', () => {
            expect(parseInput('3 cans tuna')).toEqual({ quantity: '3', unit: 'cans', description: 'tuna' })
        })

        it('"1 dozen eggs"', () => {
            expect(parseInput('1 dozen eggs')).toEqual({ quantity: '1', unit: 'dozen', description: 'eggs' })
        })

        it('"2 loaves bread"', () => {
            expect(parseInput('2 loaves bread')).toEqual({ quantity: '2', unit: 'loaves', description: 'bread' })
        })

        it('"0.5 lb ground beef" (decimal quantity, multi-word description)', () => {
            expect(parseInput('0.5 lb ground beef')).toEqual({ quantity: '0.5', unit: 'lb', description: 'ground beef' })
        })

        it('"4 packs ramen"', () => {
            expect(parseInput('4 packs ramen')).toEqual({ quantity: '4', unit: 'packs', description: 'ramen' })
        })

        it('"2 bunch spinach"', () => {
            expect(parseInput('2 bunch spinach')).toEqual({ quantity: '2', unit: 'bunch', description: 'spinach' })
        })

        it('"1 jar peanut butter" (multi-word description)', () => {
            expect(parseInput('1 jar peanut butter')).toEqual({ quantity: '1', unit: 'jar', description: 'peanut butter' })
        })

        it('"3 cups flour"', () => {
            expect(parseInput('3 cups flour')).toEqual({ quantity: '3', unit: 'cups', description: 'flour' })
        })

        it('"2 slices cheese"', () => {
            expect(parseInput('2 slices cheese')).toEqual({ quantity: '2', unit: 'slices', description: 'cheese' })
        })

        it('"500 g pasta"', () => {
            expect(parseInput('500 g pasta')).toEqual({ quantity: '500', unit: 'g', description: 'pasta' })
        })

        it('"2 lbs chicken"', () => {
            expect(parseInput('2 lbs chicken')).toEqual({ quantity: '2', unit: 'lbs', description: 'chicken' })
        })
    })

    // ─── Number + unit directly attached (no space) ──────────────────────────
    describe('number with unit directly attached (no space)', () => {
        it('"1.5kg Beef"', () => {
            expect(parseInput('1.5kg Beef')).toEqual({ quantity: '1.5', unit: 'kg', description: 'Beef' })
        })

        it('"500g pasta"', () => {
            expect(parseInput('500g pasta')).toEqual({ quantity: '500', unit: 'g', description: 'pasta' })
        })

        it('"2oz cream cheese"', () => {
            expect(parseInput('2oz cream cheese')).toEqual({ quantity: '2', unit: 'oz', description: 'cream cheese' })
        })
    })

    // ─── Whitespace handling ─────────────────────────────────────────────────
    describe('whitespace trimming', () => {
        it('trims leading and trailing whitespace', () => {
            expect(parseInput('  3 bags rice  ')).toEqual({ quantity: '3', unit: 'bags', description: 'rice' })
        })

        it('trims plain description input', () => {
            expect(parseInput('  Milk  ')).toEqual({ quantity: '', unit: '', description: 'Milk' })
        })

        it('trims input where word is not a unit', () => {
            expect(parseInput('  2 bell peppers  ')).toEqual({ quantity: '2', unit: '', description: 'bell peppers' })
        })
    })

    // ─── Edge cases ──────────────────────────────────────────────────────────
    describe('edge cases', () => {
        it('returns empty description for empty string', () => {
            expect(parseInput('')).toEqual({ quantity: '', unit: '', description: '' })
        })

        it('returns empty description for whitespace-only input', () => {
            expect(parseInput('   ')).toEqual({ quantity: '', unit: '', description: '' })
        })

        it('handles a large integer quantity', () => {
            expect(parseInput('100 g oats')).toEqual({ quantity: '100', unit: 'g', description: 'oats' })
        })

        it('unit matching is case-insensitive ("KG" treated as unit)', () => {
            expect(parseInput('2 KG sugar')).toEqual({ quantity: '2', unit: 'KG', description: 'sugar' })
        })

        it('"1 can" with no description — falls back to description-only', () => {
            // Cannot match regex (needs rest after unit), whole string is description
            expect(parseInput('1 can')).toEqual({ quantity: '', unit: '', description: '1 can' })
        })
    })

    // ─── QUANTITY_UNITS set sanity checks ────────────────────────────────────
    describe('QUANTITY_UNITS set', () => {
        it('contains standard weight/volume units', () => {
            expect(QUANTITY_UNITS.has('kg')).toBe(true)
            expect(QUANTITY_UNITS.has('g')).toBe(true)
            expect(QUANTITY_UNITS.has('lb')).toBe(true)
            expect(QUANTITY_UNITS.has('lbs')).toBe(true)
            expect(QUANTITY_UNITS.has('oz')).toBe(true)
            expect(QUANTITY_UNITS.has('ml')).toBe(true)
            expect(QUANTITY_UNITS.has('l')).toBe(true)
        })

        it('contains container units', () => {
            expect(QUANTITY_UNITS.has('bag')).toBe(true)
            expect(QUANTITY_UNITS.has('bags')).toBe(true)
            expect(QUANTITY_UNITS.has('bottle')).toBe(true)
            expect(QUANTITY_UNITS.has('can')).toBe(true)
            expect(QUANTITY_UNITS.has('jar')).toBe(true)
            expect(QUANTITY_UNITS.has('box')).toBe(true)
        })

        it('does NOT contain common non-unit descriptive words', () => {
            expect(QUANTITY_UNITS.has('bell')).toBe(false)
            expect(QUANTITY_UNITS.has('large')).toBe(false)
            expect(QUANTITY_UNITS.has('red')).toBe(false)
            expect(QUANTITY_UNITS.has('green')).toBe(false)
            expect(QUANTITY_UNITS.has('fresh')).toBe(false)
            expect(QUANTITY_UNITS.has('whole')).toBe(false)
        })
    })
})
