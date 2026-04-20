import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isCodeInterpreterAvailableState = createAtomState<boolean>({
  key: 'isCodeInterpreterAvailableState',
  defaultValue: false,
});
