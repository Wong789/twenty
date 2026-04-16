import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isCodeInterpreterEnabledState = createAtomState<boolean>({
  key: 'isCodeInterpreterEnabledState',
  defaultValue: false,
});
