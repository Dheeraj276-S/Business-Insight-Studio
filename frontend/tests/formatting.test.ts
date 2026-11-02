import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCompactNumber, formatExactNumber, formatMetricCompactValue, formatMetricTooltip, formatNumberWithExactValue } from '../src/analytics/formatting.ts'

test('formats crore, lakh, and thousand amounts using Indian notation', () => {
  assert.equal(formatCompactNumber(61_951_600, '₹'), '₹6.20 Cr')
  assert.equal(formatCompactNumber(45_515_300, '₹'), '₹4.55 Cr')
  assert.equal(formatCompactNumber(16_436_300, '₹'), '₹1.64 Cr')
  assert.equal(formatCompactNumber(45_500, '₹'), '₹45.5 K')
  assert.equal(formatCompactNumber(1_25_000, '₹'), '₹1.25 L')
  assert.equal(formatCompactNumber(99_999, '₹'), '₹1 L')
  assert.equal(formatCompactNumber(61_951_600), '6.20 Cr')
})

test('compact display retains exact tooltip value and detects large money KPIs', () => {
  const formatted = formatNumberWithExactValue(61_951_600, '₹')
  assert.equal(formatted.display, '₹6.20 Cr')
  assert.equal(formatted.exact, '₹6,19,51,600')
  assert.equal(formatExactNumber(45_515_300), '4,55,15,300')
  const metric = { label: 'Total revenue', value: '61951600', rawValue: 61_951_600, detail: 'Calculated from the mapped sales amount.' }
  assert.equal(formatMetricCompactValue(metric, '₹'), '₹6.20 Cr')
  assert.equal(formatMetricTooltip(metric, '₹'), 'Exact value: ₹6,19,51,600\nCalculated from the mapped sales amount.')
})
