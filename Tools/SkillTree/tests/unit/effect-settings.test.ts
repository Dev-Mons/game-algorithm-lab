import { expect, it } from 'vitest';
import { configureEffect, descriptionStyles, getDescriptionStyle } from '../../src/effect-settings';
import { effectDefaults, validateTemplate } from '../../src/effects';

it('compiles every selectable description layout into valid, reversible runtime templates', () => {
  for (const description of Object.keys(descriptionStyles)) {
    const effect = configureEffect(effectDefaults(), { target: 'MachineGun.Damage', operation: 'Add', amount: 1, description });
    validateTemplate(effect.DescriptionTemplate); validateTemplate(effect.MaxDescriptionTemplate);
    expect(getDescriptionStyle(effect)).toBe(description);
  }
});
it('rejects unknown choice keys and invalid numeric amounts', () => {
  const previous = effectDefaults();
  const valid = { target: 'MachineGun.Damage', operation: 'Add', amount: 1, description: 'bonus' };
  for (const invalid of [{ target: 'MachineGun.Damgae' }, { operation: 'Multiply' }, { amount: NaN }, { description: 'bonnus' }, { description: '__proto__' }]) {
    expect(() => configureEffect(previous, { ...valid, ...invalid })).toThrow();
  }
});
it('retains legacy templates until a known layout is explicitly selected', () => {
  const previous = { ...effectDefaults(), StatId: 'Custom.Damage', DescriptionTemplate: '피해: {CurrentValue}', MaxDescriptionTemplate: '완료' };
  expect(configureEffect(previous, { target: previous.StatId, operation: 'Add', amount: 3, description: 'legacy' })).toMatchObject({
    DescriptionTemplate: previous.DescriptionTemplate, MaxDescriptionTemplate: previous.MaxDescriptionTemplate,
  });
});
